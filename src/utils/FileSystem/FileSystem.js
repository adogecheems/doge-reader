/**
 * File access adapter for the dictionary-pen runtime.
 *
 * 优先级：
 *   1) 动态 `import('fs')` —— 笔上内置的 fs jsapi，或随 AMR 打包的
 *      libjsapi_fs.so（native/fs_plugin.c）注册的同名模块。
 *   2) `global.execShell`（PenMusic 文档化的可移植兜底）拼 shell 命令实现。
 *
 * 注意：`fs` 必须动态 import —— 静态 import 在模块缺失时会让整个模块链
 * 求值失败（页面白屏），动态 import 的异常可以捕获后走兜底。
 *
 * 对外导出：
 *   - fs              Promise 风格的 fs 兼容层（readdir/stat/exists/mkdir/rm/
 *                     unlink/readFile/writeFile），方法形状与原生模块一致
 *   - getFs()         返回实际生效的 fs 实现（原生或兜底）
 *   - readDirectory   fs.readdir(path, {withFileTypes:true}) 的别名
 *   - readTextFile    fs.readFile(path) 的别名
 *   - execShell       shell 桥（保留给需要命令级操作的调用方）
 */

// ---- execShell 桥 ----

async function getExecShell() {
    // Some firmware exposes an already-instantiated global object.
    if (typeof global !== 'undefined' && global
        && typeof global.execShell === 'function') {
        return global.execShell.bind(global);
    }

    if (typeof globalThis !== 'undefined') {
        if (globalThis.global && typeof globalThis.global.execShell === 'function') {
            return globalThis.global.execShell.bind(globalThis.global);
        }
        if (typeof globalThis.execShell === 'function') {
            return globalThis.execShell.bind(globalThis);
        }
    }

    // PenMusic documents "global" as a system module. On builds where it is
    // exposed as a module rather than a global variable, instantiate it here.
    try {
        const module = await import('global');
        const Global = module.default || module.Global;
        const api = Global && typeof Global === 'function'
            ? new Global()
            : (Global || module);

        if (api && typeof api.execShell === 'function') {
            return api.execShell.bind(api);
        }
    } catch (error) {
        // Keep the final error focused on the missing platform capability.
    }

    throw new Error('当前设备未提供 global.execShell，无法访问本地文件');
}

function shellQuote(value) {
    // POSIX single-quote escaping: ' -> '\''
    return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function getOutput(result) {
    if (typeof result === 'string') return result;
    if (result == null) return '';
    if (typeof result.output === 'string') return result.output;
    if (typeof result.stdout === 'string') return result.stdout;
    if (typeof result.data === 'string') return result.data;
    if (typeof result.text === 'string') return result.text;
    return String(result);
}

async function execShell(command) {
    const exec = await getExecShell();
    const result = await exec(command + '\nprintf "\n__READEX_STATUS__%s\n" "$?"');
    const output = getOutput(result);
    const match = output.match(/\n__READEX_STATUS__(\d+)\s*$/);

    if (match) {
        const body = output.slice(0, match.index);
        if (Number(match[1]) !== 0) {
            throw new Error(body.trim() || ('Shell command failed: ' + command));
        }
        return body;
    }

    // A few wrappers return structured status instead of preserving the
    // shell marker; support those without assuming stdout is always present.
    if (result && typeof result === 'object'
        && typeof result.status === 'number' && result.status !== 0) {
        throw new Error(output || ('Shell command failed: ' + command));
    }

    return output;
}

/** 执行命令并返回布尔成败（不抛异常），用于 exists/mkdir/rm 一类探测操作。 */
async function shellOk(command) {
    const out = await execShell(
        'if ' + command + '; then printf 1; else printf 0; fi'
    );
    return out.trim() === '1';
}

// ---- execShell 兜底 fs ----

function shellDirents(output, dirPath) {
    const lines = output.split(/\r?\n/).filter(Boolean);

    if (lines.some(line => /^(ls:|cannot access|permission denied|not found)/i.test(line.trim()))) {
        throw new Error(lines.join('\n'));
    }

    const base = String(dirPath).replace(/\/+$/, '');
    return lines.map(line => {
        const isDirectory = line.endsWith('/');
        const name = isDirectory ? line.slice(0, -1) : line;
        return {
            name,
            path: base + '/' + name,
            isDirectory() {
                return isDirectory;
            },
            isFile() {
                return !isDirectory;
            }
        };
    }).filter(entry => entry.name && entry.name !== '.' && entry.name !== '..');
}

const fsLike = {
    async readdir(path, options = {}) {
        // -A omits . and ..; -p appends '/' to directory names. This avoids
        // relying on Node Dirent objects or unsupported fs.readdir options.
        const output = await execShell('LC_ALL=C ls -1Ap ' + shellQuote(path) + ' 2>&1');
        const entries = shellDirents(output, path);
        return options.withFileTypes ? entries : entries.map(entry => entry.name);
    },

    async stat(path) {
        const quoted = shellQuote(path);
        const isDirectory = await shellOk('test -d ' + quoted);
        let size = 0;
        if (!isDirectory) {
            const out = await execShell('wc -c < ' + quoted + ' 2>&1');
            size = parseInt(out.trim(), 10) || 0;
        }
        // mtimeMs 在 shell 兜底下不提供（调用面只消费 size）。
        return {
            size,
            mode: 0,
            mtimeMs: 0,
            isFile: !isDirectory,
            isDirectory
        };
    },

    async exists(path) {
        return shellOk('test -e ' + shellQuote(path));
    },

    async mkdir(path) {
        return shellOk('mkdir -p ' + shellQuote(path));
    },

    async rm(path) {
        return shellOk('rm -rf ' + shellQuote(path));
    },

    async unlink(path) {
        return shellOk('rm -f ' + shellQuote(path));
    },

    async readFile(path) {
        // cat preserves UTF-8 text and does not require the unavailable fs module.
        return execShell('cat ' + shellQuote(path) + ' 2>&1');
    },

    async writeFile(path, data) {
        await execShell(
            'printf %s ' + shellQuote(data) + ' > ' + shellQuote(path)
        );
    }
};

// ---- 原生 fs 探测与统一入口 ----

let fsModuleState = undefined; // undefined=未探测, null=不可用, 否则=fs 模块对象

async function nativeFs() {
    if (fsModuleState !== undefined) return fsModuleState;
    try {
        const m = await import('fs');
        const mod = m && (m.default || m);
        if (mod && typeof mod.readdir === 'function') {
            fsModuleState = mod;
            return mod;
        }
    } catch (error) {
        // 模块不存在（未内置 jsapi 且插件未加载）
    }
    fsModuleState = null;
    return null;
}

/** 返回实际生效的 fs 实现：原生模块优先，execShell 兜底。 */
async function getFs() {
    return (await nativeFs()) || fsLike;
}

/** Promise 风格 fs 兼容层，形状与原生 fs 模块一致。 */
const fs = {
    readdir(path, options) {
        return getFs().then(impl => impl.readdir(path, options));
    },
    stat(path) {
        return getFs().then(impl => impl.stat(path));
    },
    exists(path) {
        return getFs().then(impl => impl.exists(path));
    },
    mkdir(path) {
        return getFs().then(impl => impl.mkdir(path));
    },
    rm(path) {
        return getFs().then(impl => impl.rm(path));
    },
    unlink(path) {
        return getFs().then(impl => impl.unlink(path));
    },
    readFile(path) {
        return getFs().then(impl => impl.readFile(path));
    },
    writeFile(path, data) {
        return getFs().then(impl => impl.writeFile(path, data));
    }
};

async function readDirectory(path) {
    return (await getFs()).readdir(path, { withFileTypes: true });
}

async function readTextFile(path) {
    return (await getFs()).readFile(path);
}

export {
    execShell,
    fs,
    getFs,
    readDirectory,
    readTextFile
};
