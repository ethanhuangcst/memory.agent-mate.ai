#!/usr/bin/env bash
# 构建门户镜像（Sprint 5 `#1`）—— 门户镜像的**唯一构建入口**（`make portal-image`）。
#
# 它只做三件事，且都不含判断逻辑（判据归探针 `probes/portal-image-verdict-probe/`）：
#   ① 从 upstream.lock 取上游坐标（**不手写 tag** ⇒ ADR-004 单一真相源）
#   ② 以 **buildx + linux/amd64** 构建（上游二进制单平台；legacy builder 下 COPY --from 会按宿主
#      平台解析而失败 —— 实测见 probes/portal-image-verdict-probe/README.md）
#   ③ 打印产物坐标与后置校验入口
#
# 用法：
#   bash memory.agent-mate.ai/scripts/build-portal-image.sh [--print-only] [--tag <name:tag>]
#   make portal-image            # 等价入口
#
# 退出码：0 成功 · 10 前置缺失（buildx / 守护 / Dockerfile / lock 键）· 20 运行错误 · 30 构建失败
#
# 只读边界：不改任何受版本控制的文件；产物只落在本机 docker 镜像库（`--load`）。
# 时间提示：本机为 Apple Silicon ⇒ linux/amd64 构建走模拟，**首次** `npm ci` 可能数分钟（正常）。

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT="$(cd "${SCRIPT_DIR}/.." && pwd)"        # memory.agent-mate.ai/
REPO_ROOT="$(cd "${PRODUCT}/.." && pwd)"
PORTAL_DIR="${PRODUCT}/admin_portal"
LOCK="${PRODUCT}/upstream.lock"
DOCKERFILE="${PORTAL_DIR}/Dockerfile"

die() { printf 'ERROR: %s\n' "$2" >&2; exit "$1"; }
log() { printf '  %s\n' "$1"; }

PRINT_ONLY=0
TAG_OVERRIDE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --print-only) PRINT_ONLY=1 ;;
    --tag) shift; TAG_OVERRIDE="${1:-}" ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die 20 "未知参数：$1（支持 --print-only / --tag <name:tag>）" ;;
  esac
  shift
done

echo "=== 门户镜像构建（Sprint 5 #1）==="

# ── 前置：lock 坐标 ──────────────────────────────────────────────────────────────────────────
[ -f "${LOCK}" ] || die 10 "缺 upstream.lock（版本契约的唯一真相源）：${LOCK}"
IMAGE_REPO="$(sed -n 's/^IMAGE_REPO="\(.*\)"$/\1/p' "${LOCK}" | head -1)"
IMAGE_TAG="$(sed -n 's/^IMAGE_TAG="\(.*\)"$/\1/p' "${LOCK}" | head -1)"
UPSTREAM_RELEASE_TAG="$(sed -n 's/^UPSTREAM_RELEASE_TAG="\(.*\)"$/\1/p' "${LOCK}" | head -1)"
[ -n "${IMAGE_REPO}" ] || die 10 "upstream.lock 缺 IMAGE_REPO"
[ -n "${IMAGE_TAG}" ] || die 10 "upstream.lock 缺 IMAGE_TAG"
UPSTREAM_IMAGE="${IMAGE_REPO}:${IMAGE_TAG}"
[ "${UPSTREAM_RELEASE_TAG#v}" = "${IMAGE_TAG}" ] \
  || die 10 "锁自相矛盾：UPSTREAM_RELEASE_TAG=${UPSTREAM_RELEASE_TAG} 去 v 后 != IMAGE_TAG=${IMAGE_TAG}"
log "锁侧坐标：${UPSTREAM_IMAGE}（release tag ${UPSTREAM_RELEASE_TAG}）"

# ── 前置：构建文件与工具链 ───────────────────────────────────────────────────────────────────
[ -f "${DOCKERFILE}" ] || die 10 "缺 Dockerfile：${DOCKERFILE}"
[ -f "${PORTAL_DIR}/package-lock.json" ] || die 10 "缺 package-lock.json（npm ci 的前提）"
[ -f "${PORTAL_DIR}/.dockerignore" ] || die 10 "缺 .dockerignore（宿主 arm64 node_modules 会污染镜像）"
command -v docker >/dev/null 2>&1 || die 10 "未找到 docker"
docker info >/dev/null 2>&1 || die 10 "docker 守护不可用（colima start？）"
docker buildx version >/dev/null 2>&1 \
  || die 10 "缺 buildx 插件（brew install docker-buildx 并软链到 ~/.docker/cli-plugins/）"

# 产物 tag 用**专用**变量 PORTAL_BUILD_TAG：不复用 PORTAL_IMAGE —— 后者在 compose/portal.env 里指
# 「要运行的那张已推送镜像」，与「本次本机构建产物」是两件事（实测：复用会让本机残留的同名变量
# 直接覆盖 tag，构建出 ghcr.io/example/... 这种非预期坐标）。
LOCAL_IMAGE="${TAG_OVERRIDE:-${PORTAL_BUILD_TAG:-memory-agent-mate-portal:${IMAGE_TAG}}}"
PLATFORM="${PLATFORM:-linux/amd64}"

CMD=(docker buildx build
  --platform "${PLATFORM}"
  --load
  --tag "${LOCAL_IMAGE}"
  --build-arg "UPSTREAM_IMAGE=${UPSTREAM_IMAGE}"
  --build-arg "IMAGE_TAG=${IMAGE_TAG}"
  --file "${DOCKERFILE}"
  "${PORTAL_DIR}")

# 可选：构建缓存（CI 用 GHA 缓存时由调用方传；本机默认不用 —— 让「构建配方只有一个真相源」，
# 不为了缓存把 recipe 复制进 workflow 的 YAML）
[ -n "${PORTAL_BUILD_CACHE_FROM:-}" ] && CMD+=(--cache-from "${PORTAL_BUILD_CACHE_FROM}")
[ -n "${PORTAL_BUILD_CACHE_TO:-}" ] && CMD+=(--cache-to "${PORTAL_BUILD_CACHE_TO}")

log "目标镜像：${LOCAL_IMAGE}"
log "平台：${PLATFORM}（上游二进制单平台；宿主非 amd64 时走模拟，慢属正常）"

if [ "${PRINT_ONLY}" -eq 1 ]; then
  echo
  echo "--- 将要执行的命令（--print-only）---"
  printf '  %q \\\n' "${CMD[@]}" | sed '$ s/ \\$//'
  exit 0
fi

echo
echo "--- 构建中（首次可能数分钟）---"
if ! "${CMD[@]}"; then
  die 30 "构建失败：见上方 buildx 输出（平台解析失败 ⇒ 检查是否走了 buildx 而非 legacy builder）"
fi

echo
echo "--- 产物 ---"
IMG_ID="$(docker image inspect --format '{{.Id}}' "${LOCAL_IMAGE}" 2>/dev/null)"
IMG_SIZE="$(docker image inspect --format '{{.Size}}' "${LOCAL_IMAGE}" 2>/dev/null)"
ARCH="$(docker image inspect --format '{{.Architecture}}' "${LOCAL_IMAGE}" 2>/dev/null)"
DIGEST="$(docker image inspect --format '{{index .RepoDigests 0}}' "${LOCAL_IMAGE}" 2>/dev/null)"
log "镜像：${LOCAL_IMAGE}"
log "ID：${IMG_ID:-（取不到）} · 平台：${ARCH:-?} · 体积：$(awk "BEGIN{printf \"%.0f MB\", ${IMG_SIZE:-0}/1024/1024}")"
log "RepoDigest：${DIGEST:-（无 —— 未推送时正常）}"
log "环境变量注入：UPSTREAM_IMAGE=${UPSTREAM_IMAGE} · IMAGE_TAG=${IMAGE_TAG}"

echo
echo "OK：镜像已构建（本机镜像库，未推送）"
echo "  下一步（**判据在探针里，不在本脚本里**）："
echo "    bash memory.agent-mate.ai/probes/portal-image-verdict-probe/probe.sh   # 相 3 判门户镜像契约"
echo "  部署侧：把本镜像推到 registry 后，在 deploy/portal.env 里设 PORTAL_IMAGE=${LOCAL_IMAGE}"
exit 0
