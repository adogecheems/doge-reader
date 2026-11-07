#!/usr/bin/env bash
# readex 原生 fs 插件交叉编译脚本
# 产出 libs/libjsapi_fs.so（随 AMR 打包），目标：ARMv7 EABI5 hard-float / glibc 2.23。
#
# 用法:
#   tools/build-fs-plugin.sh            # 自动选工具链编译 + ELF 自检 + 装入 libs/
#   tools/build-fs-plugin.sh --check    # 仅对 libs/libjsapi_fs.so 做 ELF 自检
#
# 工具链优先级: zig cc（钉 glibc 2.23 符号版本） > arm-linux-gnueabihf-gcc
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/native/fs_plugin.c"
INC="$ROOT/native/quickjs"
OUT_DIR="$ROOT/native/dist"
OUT="$OUT_DIR/libjsapi_fs.so"
TARGET_LIBS="$ROOT/libs/libjsapi_fs.so"
EXPECT_GLIBC="2.23"

# ZIG 环境变量可指定 zig 路径，默认从 PATH 找
ZIG="$(command -v "${ZIG:-zig}" 2>/dev/null || true)"

check_elf() {
  local so="$1"
  echo "== ELF 自检: $so =="
  local fail=0

  local machine
  machine=$(readelf -h "$so" | awk '/Machine:/{print $NF}')
  if [ "$machine" != "ARM" ]; then
    echo "校验失败: 期望 Machine=ARM 得到 $machine"; fail=1
  fi

  if ! readelf -A "$so" | grep -q 'Tag_ABI_VFP_args: VFP registers'; then
    echo "校验失败: 不是 hard-float (Tag_ABI_VFP_args)"; fail=1
  fi

  if ! nm -D "$so" 2>/dev/null | grep -q ' T custom_init_jsapis'; then
    echo "校验失败: 未导出 custom_init_jsapis"; fail=1
  fi

  if nm -D "$so" 2>/dev/null | grep -q ' U registerCModuleLoader'; then
    echo "OK: registerCModuleLoader 留待宿主框架解析（预期的未定义符号）"
  fi

  local needed
  needed=$(readelf -d "$so" | grep NEEDED | awk '{print $NF}' | tr -d '[]' | tr '\n' ' ')
  echo "NEEDED: $needed"
  for lib in $needed; do
    case "$lib" in
      libc.so*|ld-linux*|libgcc_s.so*) ;;
      *) echo "校验失败: 依赖了非基础库 $lib"; fail=1 ;;
    esac
  done

  local glibc_max
  glibc_max=$(readelf -V "$so" 2>/dev/null | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1 || true)
  echo "GLIBC 符号版本上限: ${glibc_max:-无}"
  if [ -n "$glibc_max" ]; then
    local ver="${glibc_max#GLIBC_}"
    if [ "$(printf '%s\n%s\n' "$EXPECT_GLIBC" "$ver" | sort -V | tail -1)" != "$EXPECT_GLIBC" ]; then
      echo "校验失败: 引用了高于 glibc $EXPECT_GLIBC 的符号 ($glibc_max)，老固件会挂"; fail=1
    fi
  fi

  [ "$fail" = 0 ] || { echo "ELF 自检未通过"; exit 1; }
  echo "== ELF 自检通过 =="
}

if [ "${1:-}" = "--check" ]; then
  check_elf "$TARGET_LIBS"
  exit 0
fi

mkdir -p "$OUT_DIR"

echo "== 编译 $OUT （目标 armv7 hard-float, glibc $EXPECT_GLIBC） =="
if [ -n "$ZIG" ]; then
  echo "== 工具链: $ZIG =="
  "$ZIG" cc -target arm-linux-gnueabihf.${EXPECT_GLIBC} \
    -shared -fPIC -O2 -fvisibility=hidden \
    -I "$INC" "$SRC" -o "$OUT"
elif command -v arm-linux-gnueabihf-gcc >/dev/null 2>&1; then
  echo "== 工具链: arm-linux-gnueabihf-gcc（注意: 链接宿主交叉 glibc，需自检符号版本） =="
  arm-linux-gnueabihf-gcc -shared -fPIC -O2 -fvisibility=hidden -static-libgcc \
    -I "$INC" "$SRC" -o "$OUT"
else
  echo "错误: 未找到 zig 或 arm-linux-gnueabihf-gcc" >&2
  exit 1
fi

check_elf "$OUT"

cp "$OUT" "$TARGET_LIBS"
echo "== 已装入 $TARGET_LIBS（aiot-cli 打包时随 libs/ 进 AMR） =="
echo "提示: 升级安装前先 miniapp_cli uninstall，同 appid 不会重新提取 libs/*.so"
