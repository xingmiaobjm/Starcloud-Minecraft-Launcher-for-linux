#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PKGNAME="starcloud-launcher-bin"
INSTALL=0
CLEAN=0

usage() {
  cat <<EOF
用法: $0 [选项]

选项:
  -i, --install    构建成功后 sudo pacman -U 安装
  -c, --clean      构建前清理 src/ pkg/ 和旧包
  -h, --help       显示帮助
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -i|--install) INSTALL=1; shift ;;
    -c|--clean)   CLEAN=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage; exit 1 ;;
  esac
done

[[ -f PKGBUILD ]] || { echo "错误: 当前目录没有 PKGBUILD" >&2; exit 1; }
command -v makepkg >/dev/null || { echo "错误: 未找到 makepkg（需要 base-devel）" >&2; exit 1; }
[[ $EUID -eq 0 ]] && { echo "错误: 不要用 root 运行 makepkg" >&2; exit 1; }

if [[ $CLEAN -eq 1 ]]; then
  echo ">> 清理 src/ pkg/ 和旧包"
  rm -rf src pkg
  rm -f ./*.pkg.tar.zst ./*.pkg.tar.zst.sig
fi

current_pkgver=$(grep -E '^pkgver=' PKGBUILD | cut -d= -f2)
current_pkgrel=$(grep -E '^pkgrel=' PKGBUILD | cut -d= -f2)
echo ">> 构建 ${PKGNAME} ${current_pkgver}-${current_pkgrel}"

makepkg -f --noconfirm --syncdeps

pkgfile=$(ls -t ./*.pkg.tar.zst 2>/dev/null | head -n1 || true)
[[ -n "$pkgfile" ]] || { echo "错误: 未找到构建产物" >&2; exit 1; }
echo ">> 产物: $pkgfile"

echo ">> 校验包内容"
bsdtar -tf "$pkgfile" | grep -q '^opt/starcloud-launcher/' \
  || echo "警告: 包内未找到 /opt/starcloud-launcher/" >&2
bsdtar -tf "$pkgfile" | grep -q '^usr/bin/starcloud-launcher$' \
  || echo "警告: 包内未找到 /usr/bin/starcloud-launcher" >&2

if command -v namcap >/dev/null 2>&1; then
  echo ">> namcap 检查"
  namcap PKGBUILD "$pkgfile" || true
else
  echo "提示: 未安装 namcap（sudo pacman -S namcap）"
fi

if [[ $INSTALL -eq 1 ]]; then
  echo ">> 安装 $pkgfile"
  sudo pacman -U --noconfirm "$pkgfile"
  echo ">> 安装完成，可运行: starcloud-launcher"
fi