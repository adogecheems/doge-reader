/*
 * fs_plugin.c — readex 原生 fs 模块（有道词典笔 jsapi 插件）
 *
 * 按框架 jsapi ABI 导出 custom_init_jsapis，把本模块注册为 ES 模块 "fs"，
 * 让 `import fs from 'fs'` 在未内置 fs jsapi 的固件（如 PenOS 4.3.5+）上也能解析。
 *
 * 基于 adogecheems/doge-comic jsapi/src/fs.cpp（AGPLv3）移植补全：
 *   - readdir 支持 withFileTypes（Dirent: name/path/isFile()/isDirectory()）
 *   - 新增 exists / mkdir（递归）/ rm（递归）
 *   - 错误以 Error 对象 reject（message: "<syscall> <path>: <strerror>"）
 *
 * API 面（与 readex 调用面逐一对应，勿随意更改形状）：
 *   readdir(path[, {withFileTypes}]) -> Promise<[{name,path,isFile(),isDirectory()}]|string[]>
 *   stat(path)      -> Promise<{size,mode,mtimeMs,isFile,isDirectory}>  // 此处为布尔属性
 *   exists(path)    -> Promise<boolean>
 *   mkdir(path)     -> Promise<boolean>   // mkdir -p 语义，成功 true / 失败 false
 *   rm(path)        -> Promise<boolean>   // rm -rf 语义（文件或非空目录）
 *   unlink(path)    -> Promise<boolean>   // 仅删文件
 *   readFile(path)  -> Promise<string>
 *   writeFile(path, data) -> Promise<undefined>  // 失败 reject
 *
 * 编译（见 tools/build-fs-plugin.sh）：
 *   zig cc -target arm-linux-gnueabihf.2.23 -shared -fPIC -O2 \
 *       -I native/quickjs native/fs_plugin.c -o libs/libjsapi_fs.so
 *
 * SPDX-License-Identifier: AGPL-3.0
 * 上游出处：https://github.com/adogecheems/doge-comic （jsapi/src/fs.cpp，作者 adogecheems）
 */

#include "quickjs.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ---- 宿主框架接口（iot-miniapp-sdk jsmodules/JSCModuleExtension.h）----
 * registerCModuleLoader 由框架提供，.so 内保持未定义动态符号即可。 */
typedef JSModuleDef* (*LoadCModuleFunction)(JSContext* context, const char* moduleName);
extern void registerCModuleLoader(const char* moduleName, LoadCModuleFunction loader);

/* ---------------- Promise 工具（沿用上游 fs.cpp 的包装方式） ---------------- */

static JSValue make_resolved_promise(JSContext* ctx, JSValue value)
{
    JSValue funcs[2];
    JSValue promise = JS_NewPromiseCapability(ctx, funcs);
    JS_Call(ctx, funcs[0], JS_UNDEFINED, 1, (JSValueConst*)&value);
    JS_FreeValue(ctx, funcs[0]);
    JS_FreeValue(ctx, funcs[1]);
    JS_FreeValue(ctx, value);
    return promise;
}

static JSValue make_rejected_promise(JSContext* ctx, JSValue error)
{
    JSValue funcs[2];
    JSValue promise = JS_NewPromiseCapability(ctx, funcs);
    JS_Call(ctx, funcs[1], JS_UNDEFINED, 1, (JSValueConst*)&error);
    JS_FreeValue(ctx, funcs[0]);
    JS_FreeValue(ctx, funcs[1]);
    JS_FreeValue(ctx, error);
    return promise;
}

static JSValue make_error(JSContext* ctx, const char* syscall, const char* path)
{
    char msg[512];
    snprintf(msg, sizeof(msg), "%s %s: %s",
             syscall, path ? path : "", strerror(errno));
    JSValue error = JS_NewError(ctx);
    JS_SetPropertyStr(ctx, error, "message", JS_NewString(ctx, msg));
    return error;
}

static JSValue reject_errno(JSContext* ctx, const char* syscall, const char* path)
{
    return make_rejected_promise(ctx, make_error(ctx, syscall, path));
}

static JSValue resolve_bool(JSContext* ctx, int value)
{
    return make_resolved_promise(ctx, JS_NewBool(ctx, value != 0));
}

/* ---------------- 路径工具 ---------------- */

/* 拼接 dir + "/" + name，调用方 free */
static char* path_join(const char* dir, const char* name)
{
    size_t dl = strlen(dir);
    size_t nl = strlen(name);
    int need_sep = (dl > 0 && dir[dl - 1] != '/');
    char* buf = (char*)malloc(dl + need_sep + nl + 1);
    if (!buf)
        return NULL;
    memcpy(buf, dir, dl);
    if (need_sep)
        buf[dl] = '/';
    memcpy(buf + dl + need_sep, name, nl + 1);
    return buf;
}

/* mkdir -p：逐级创建，已存在且为目录视为成功 */
static int mkdir_p(const char* path)
{
    size_t len = strlen(path);
    char* buf = (char*)malloc(len + 1);
    if (!buf)
        return -1;
    memcpy(buf, path, len + 1);

    char* p = buf;
    if (*p == '/')
        p++;
    for (; *p; p++) {
        if (*p != '/')
            continue;
        *p = '\0';
        if (mkdir(buf, 0755) != 0 && errno != EEXIST) {
            free(buf);
            return -1;
        }
        *p = '/';
    }
    if (mkdir(buf, 0755) != 0 && errno != EEXIST) {
        free(buf);
        return -1;
    }
    free(buf);
    return 0;
}

/* rm -rf：递归删除文件或目录（不跟随符号链接），成功 0 / 失败 -1 */
static int rm_rf(const char* path)
{
    struct stat st;
    if (lstat(path, &st) != 0)
        return -1;

    if (!S_ISDIR(st.st_mode))
        return unlink(path);

    DIR* dir = opendir(path);
    if (!dir)
        return -1;

    struct dirent* ent;
    int ret = 0;
    while ((ent = readdir(dir))) {
        if (!strcmp(ent->d_name, ".") || !strcmp(ent->d_name, ".."))
            continue;
        char* child = path_join(path, ent->d_name);
        if (!child) {
            ret = -1;
            break;
        }
        ret = rm_rf(child);
        free(child);
        if (ret != 0)
            break;
    }
    closedir(dir);
    if (ret != 0)
        return -1;
    return rmdir(path);
}

/* ---------------- Dirent 方法（从隐藏属性读取类型） ---------------- */

static JSValue dirent_is_file(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst* argv)
{
    (void)argc;
    (void)argv;
    JSValue flag = JS_GetPropertyStr(ctx, this_val, "__isFile");
    JSValue ret = JS_NewBool(ctx, JS_ToBool(ctx, flag));
    JS_FreeValue(ctx, flag);
    return ret;
}

static JSValue dirent_is_directory(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst* argv)
{
    (void)argc;
    (void)argv;
    JSValue flag = JS_GetPropertyStr(ctx, this_val, "__isDirectory");
    JSValue ret = JS_NewBool(ctx, JS_ToBool(ctx, flag));
    JS_FreeValue(ctx, flag);
    return ret;
}

/* ---------------- fs 方法 ---------------- */

static JSValue fs_readdir(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst* argv)
{
    (void)this_val;
    const char* path = JS_ToCString(ctx, argv[0]);
    if (!path)
        return JS_EXCEPTION;

    int with_types = 0;
    if (argc > 1 && JS_IsObject(argv[1])) {
        JSValue flag = JS_GetPropertyStr(ctx, argv[1], "withFileTypes");
        with_types = JS_ToBool(ctx, flag);
        JS_FreeValue(ctx, flag);
    }

    DIR* dir = opendir(path);
    if (!dir) {
        JSValue err = make_error(ctx, "readdir", path);
        JS_FreeCString(ctx, path);
        return make_rejected_promise(ctx, err);
    }

    JSValue arr = JS_NewArray(ctx);
    struct dirent* ent;
    uint32_t idx = 0;

    while ((ent = readdir(dir))) {
        if (!strcmp(ent->d_name, ".") || !strcmp(ent->d_name, ".."))
            continue;

        if (!with_types) {
            JS_SetPropertyUint32(ctx, arr, idx++, JS_NewString(ctx, ent->d_name));
            continue;
        }

        char* full = path_join(path, ent->d_name);
        struct stat st;
        int is_file = 0, is_dir = 0;
        if (full && lstat(full, &st) == 0) {
            is_file = S_ISREG(st.st_mode);
            is_dir = S_ISDIR(st.st_mode);
        }

        JSValue obj = JS_NewObject(ctx);
        JS_SetPropertyStr(ctx, obj, "name", JS_NewString(ctx, ent->d_name));
        JS_SetPropertyStr(ctx, obj, "path",
                          JS_NewString(ctx, full ? full : ent->d_name));
        JS_SetPropertyStr(ctx, obj, "__isFile", JS_NewBool(ctx, is_file));
        JS_SetPropertyStr(ctx, obj, "__isDirectory", JS_NewBool(ctx, is_dir));
        JS_SetPropertyStr(ctx, obj, "isFile",
                          JS_NewCFunction(ctx, dirent_is_file, "isFile", 0));
        JS_SetPropertyStr(ctx, obj, "isDirectory",
                          JS_NewCFunction(ctx, dirent_is_directory, "isDirectory", 0));
        JS_SetPropertyUint32(ctx, arr, idx++, obj);
        free(full);
    }

    closedir(dir);
    JS_FreeCString(ctx, path);
    return make_resolved_promise(ctx, arr);
}

static JSValue fs_stat(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst* argv)
{
    (void)this_val;
    (void)argc;
    const char* path = JS_ToCString(ctx, argv[0]);
    if (!path)
        return JS_EXCEPTION;

    struct stat st;
    if (stat(path, &st) != 0) {
        JSValue err = make_error(ctx, "stat", path);
        JS_FreeCString(ctx, path);
        return make_rejected_promise(ctx, err);
    }
    JS_FreeCString(ctx, path);

    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "size", JS_NewInt64(ctx, st.st_size));
    JS_SetPropertyStr(ctx, obj, "mode", JS_NewInt32(ctx, st.st_mode));
    JS_SetPropertyStr(ctx, obj, "mtimeMs",
                      JS_NewFloat64(ctx, (double)st.st_mtime * 1000.0));
    JS_SetPropertyStr(ctx, obj, "isFile", JS_NewBool(ctx, S_ISREG(st.st_mode)));
    JS_SetPropertyStr(ctx, obj, "isDirectory", JS_NewBool(ctx, S_ISDIR(st.st_mode)));
    return make_resolved_promise(ctx, obj);
}

static JSValue fs_exists(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst* argv)
{
    (void)this_val;
    (void)argc;
    const char* path = JS_ToCString(ctx, argv[0]);
    if (!path)
        return JS_EXCEPTION;
    int ok = access(path, F_OK) == 0;
    JS_FreeCString(ctx, path);
    return resolve_bool(ctx, ok);
}

static JSValue fs_mkdir(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst* argv)
{
    (void)this_val;
    (void)argc;
    const char* path = JS_ToCString(ctx, argv[0]);
    if (!path)
        return JS_EXCEPTION;
    int ok = mkdir_p(path) == 0;
    JS_FreeCString(ctx, path);
    return resolve_bool(ctx, ok);
}

static JSValue fs_rm(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst* argv)
{
    (void)this_val;
    (void)argc;
    const char* path = JS_ToCString(ctx, argv[0]);
    if (!path)
        return JS_EXCEPTION;
    int ok = rm_rf(path) == 0;
    JS_FreeCString(ctx, path);
    return resolve_bool(ctx, ok);
}

static JSValue fs_unlink(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst* argv)
{
    (void)this_val;
    (void)argc;
    const char* path = JS_ToCString(ctx, argv[0]);
    if (!path)
        return JS_EXCEPTION;
    int ok = unlink(path) == 0;
    JS_FreeCString(ctx, path);
    return resolve_bool(ctx, ok);
}

static JSValue fs_read_file(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst* argv)
{
    (void)this_val;
    (void)argc;
    const char* path = JS_ToCString(ctx, argv[0]);
    if (!path)
        return JS_EXCEPTION;

    FILE* fp = fopen(path, "rb");
    if (!fp) {
        JSValue err = make_error(ctx, "readFile", path);
        JS_FreeCString(ctx, path);
        return make_rejected_promise(ctx, err);
    }

    fseek(fp, 0, SEEK_END);
    long size = ftell(fp);
    rewind(fp);
    if (size < 0)
        size = 0;

    char* buf = (char*)malloc((size_t)size + 1);
    if (!buf) {
        fclose(fp);
        JS_FreeCString(ctx, path);
        return make_rejected_promise(ctx, JS_NewError(ctx));
    }
    size_t nread = fread(buf, 1, (size_t)size, fp);
    fclose(fp);

    JSValue result = JS_NewStringLen(ctx, buf, (size_t)nread);
    free(buf);
    JS_FreeCString(ctx, path);
    return make_resolved_promise(ctx, result);
}

static JSValue fs_write_file(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst* argv)
{
    (void)this_val;
    (void)argc;
    const char* path = JS_ToCString(ctx, argv[0]);
    if (!path)
        return JS_EXCEPTION;

    size_t len;
    const char* data = JS_ToCStringLen(ctx, &len, argv[1]);
    if (!data) {
        JS_FreeCString(ctx, path);
        return JS_EXCEPTION;
    }

    FILE* fp = fopen(path, "wb");
    if (!fp) {
        JSValue err = make_error(ctx, "writeFile", path);
        JS_FreeCString(ctx, path);
        JS_FreeCString(ctx, data);
        return make_rejected_promise(ctx, err);
    }
    fwrite(data, 1, len, fp);
    fclose(fp);

    JS_FreeCString(ctx, path);
    JS_FreeCString(ctx, data);
    return make_resolved_promise(ctx, JS_UNDEFINED);
}

/* ---------------- 模块定义与注册 ---------------- */

static int fs_module_init(JSContext* ctx, JSModuleDef* m)
{
    JSValue fs = JS_NewObject(ctx);

    JS_SetPropertyStr(ctx, fs, "readdir", JS_NewCFunction(ctx, fs_readdir, "readdir", 1));
    JS_SetPropertyStr(ctx, fs, "stat", JS_NewCFunction(ctx, fs_stat, "stat", 1));
    JS_SetPropertyStr(ctx, fs, "exists", JS_NewCFunction(ctx, fs_exists, "exists", 1));
    JS_SetPropertyStr(ctx, fs, "mkdir", JS_NewCFunction(ctx, fs_mkdir, "mkdir", 1));
    JS_SetPropertyStr(ctx, fs, "rm", JS_NewCFunction(ctx, fs_rm, "rm", 1));
    JS_SetPropertyStr(ctx, fs, "unlink", JS_NewCFunction(ctx, fs_unlink, "unlink", 1));
    JS_SetPropertyStr(ctx, fs, "readFile", JS_NewCFunction(ctx, fs_read_file, "readFile", 1));
    JS_SetPropertyStr(ctx, fs, "writeFile", JS_NewCFunction(ctx, fs_write_file, "writeFile", 2));

    JS_SetModuleExport(ctx, m, "default", fs);
    return 0;
}

static JSModuleDef* fs_module_load(JSContext* ctx, const char* module_name)
{
    JSModuleDef* m = JS_NewCModule(ctx, module_name, fs_module_init);
    if (!m)
        return NULL;
    JS_AddModuleExport(ctx, m, "default");
    return m;
}

/* 框架加载 libs/libjsapi_*.so 时调用的唯一入口 */
__attribute__((visibility("default")))
void custom_init_jsapis(void)
{
    registerCModuleLoader("fs", fs_module_load);
}
