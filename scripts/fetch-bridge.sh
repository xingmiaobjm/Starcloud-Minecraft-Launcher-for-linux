#!/usr/bin/env bash
# 取得 C# 桥接（Starcloud.Bridge）并发布到 ./bridge-linux-x64。
#
# 用法：
#   ./scripts/fetch-bridge.sh                     # 用 ../starcloud-minecraft-launcher
#   ./scripts/fetch-bridge.sh /path/to/main-repo  # 指定主仓库
#   STARCLOUD_CLONE=1 ./scripts/fetch-bridge.sh   # 没有本地副本时浅克隆主仓库
#   ./scripts/fetch-bridge.sh --from-https        # 强制用 HTTPS 克隆（跳过 SSH 尝试）
#
# 克隆策略：
#   默认先尝试 SSH，失败后自动回退到 HTTPS。
#   CI 环境没有 SSH 私钥，SSH 会失败，脚本会自动改用 HTTPS（公开仓库可用）。
#
# 背景：内核（下载/安装/启动）在 C# 侧，Linux 端只做壳，不重写后端。
# 这里只发布 Linux x64 的自包含产物，供 Electron 主进程以 `dotnet` 拉起。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/bridge-linux-x64"

# ---- 解析参数 ----
FROM_HTTPS=0
MAIN_REPO_ARG=""
for arg in "$@"; do
  case "$arg" in
    --from-https) FROM_HTTPS=1 ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# //'
      exit 0
      ;;
    --*) echo "未知选项: $arg" >&2; exit 1 ;;
    *) MAIN_REPO_ARG="$arg" ;;
  esac
done

MAIN_REPO="${MAIN_REPO_ARG:-${STARCLOUD_MAIN_REPO:-$ROOT/../starcloud-minecraft-launcher}}"

CLONE_SSH="git@github.com:xingmiaobjm/Starcloud-Minecraft-Launcher.git"
CLONE_HTTPS="https://github.com/xingmiaobjm/Starcloud-Minecraft-Launcher.git"
CLONE_DIR="$ROOT/.bridge-src"

clone_repo() {
  local url="$1"
  local label="$2"
  echo "尝试用 $label 克隆: $url"
  if git clone --depth 1 "$url" "$CLONE_DIR"; then
    echo "克隆成功（$label）"
    return 0
  fi
  echo "克隆失败（$label）" >&2
  rm -rf "$CLONE_DIR"
  return 1
}

if [[ ! -d "$MAIN_REPO/dotnet/src/Starcloud.Bridge" ]]; then
  if [[ "${STARCLOUD_CLONE:-0}" == "1" ]]; then
    echo "主仓库不在 $MAIN_REPO，浅克隆到 $CLONE_DIR"

    cloned=0
    if [[ "$FROM_HTTPS" == "1" ]]; then
      # 强制 HTTPS，不尝试 SSH
      clone_repo "$CLONE_HTTPS" "HTTPS" && cloned=1
    else
      # 先 SSH，失败回退 HTTPS
      if clone_repo "$CLONE_SSH" "SSH"; then
        cloned=1
      else
        echo "SSH 克隆失败，回退到 HTTPS..." >&2
        clone_repo "$CLONE_HTTPS" "HTTPS" && cloned=1
      fi
    fi

    if [[ "$cloned" -ne 1 ]]; then
      echo "错误: SSH 和 HTTPS 克隆均失败。" >&2
      echo "  - 若主仓库为私有，请配置 SSH 私钥或使用 Deploy key" >&2
      echo "  - 若为公开仓库，检查网络或 URL: $CLONE_HTTPS" >&2
      exit 1
    fi

    MAIN_REPO="$CLONE_DIR"
  else
    echo "找不到主仓库：$MAIN_REPO" >&2
    echo "请指定路径，或设置 STARCLOUD_CLONE=1 让脚本自动克隆。" >&2
    echo "CI 环境推荐：STARCLOUD_CLONE=1 $0" >&2
    exit 1
  fi
fi

command -v dotnet >/dev/null || { echo "需要 .NET SDK 8+（未找到 dotnet）" >&2; exit 1; }

echo "从 $MAIN_REPO 发布桥接 → $OUT"
dotnet publish "$MAIN_REPO/dotnet/src/Starcloud.Bridge" \
  -c Release -r linux-x64 --self-contained false -o "$OUT"

# 只装 .NET 9/10 的机器也要能跑（csproj 里已设 RollForward=Major，这里再兜底一次）
RUNTIME_CONFIG="$OUT/Starcloud.Bridge.runtimeconfig.json"
if [[ -f "$RUNTIME_CONFIG" ]] && ! grep -q '"rollForward"' "$RUNTIME_CONFIG"; then
  sed -i 's/"tfm": "net8.0",/"tfm": "net8.0",\n    "rollForward": "Major",/' "$RUNTIME_CONFIG"
  echo "已补 rollForward=Major"
fi

echo "完成：$OUT/Starcloud.Bridge.dll"