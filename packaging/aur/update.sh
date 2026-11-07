#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# ============ 可配置参数 ============
REPO="xingmiaobjm/Starcloud-Minecraft-Launcher-for-linux"
PKGNAME="starcloud-launcher-bin"
# ====================================

DRY_RUN=0
TAG=""

usage() {
  cat <<EOF
用法: $0 [选项]

选项:
  -t, --tag TAG       指定版本 tag（如 v0.3.9-beta.1），不指定则自动查 latest
  -r, --repo OWNER/REPO  覆盖 GitHub 仓库（默认: $REPO）
  -n, --dry-run       只打印，不修改文件
  -h, --help          显示帮助
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|--tag)    TAG="${2:?缺少 tag 值}"; shift 2 ;;
    -r|--repo)   REPO="${2:?缺少 repo 值}"; shift 2 ;;
    -n|--dry-run) DRY_RUN=1; shift ;;
    -h|--help)   usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage; exit 1 ;;
  esac
done

# ---- 1. 确定 tag ----
if [[ -z "$TAG" ]]; then
  echo ">> 查询 GitHub latest release: $REPO"
  TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name":' \
    | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')
  [[ -n "$TAG" ]] || { echo "错误: 无法获取 latest tag（pre-release 不会被 latest 返回，请用 --tag）" >&2; exit 1; }
fi

# 统一成带 v 前缀
[[ "$TAG" == v* ]] || TAG="v${TAG}"

VER="${TAG#v}"
PKGVER="${VER//-/_}"

echo ">> tag:    $TAG"
echo ">> pkgver: $PKGVER"

new_pkgver_line="pkgver=${PKGVER}"
new_tag_line="_tag=\"${TAG}\""

echo
echo ">> 将写入:"
echo "   $new_pkgver_line"
echo "   $new_tag_line"

if [[ $DRY_RUN -eq 1 ]]; then
  echo ">> dry-run，未修改文件"
  exit 0
fi

[[ -f PKGBUILD ]] || { echo "错误: 当前目录没有 PKGBUILD" >&2; exit 1; }

sed -i "s|^pkgver=.*|${new_pkgver_line}|" PKGBUILD
sed -i "s|^_tag=.*|${new_tag_line}|" PKGBUILD

echo ">> 已更新 PKGBUILD"

if command -v makepkg >/dev/null 2>&1; then
  makepkg --printsrcinfo > .SRCINFO
  echo ">> 已生成 .SRCINFO"
fi

echo
echo ">> 完成。下一步:"
echo "   git diff && git add PKGBUILD .SRCINFO"
echo "   git commit -m \"upgpkg: ${PKGNAME} ${PKGVER}\""
echo "   git push"