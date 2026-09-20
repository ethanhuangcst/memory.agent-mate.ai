# memory.agent-mate.ai — 部署资产仓（公开）
# 上游 ai-memory clone 位于 ./ai-memory-mcp/（gitignored，只读约定）
# 版本契约（上游 tag / 镜像指纹）的单一真相源：hk_vps_4/upstream.lock
# 详见 hk_vps_4/specs/asset_isolation_plan.md 与 hk_vps_4/specs/dev-plan.md

UPSTREAM_URL := https://github.com/alphaonedev/ai-memory-mcp.git
LOCK := hk_vps_4/upstream.lock
PREFLIGHT := hk_vps_4/scripts/upstream-preflight.sh
SECRET_CHECK := hk_vps_4/scripts/secret-check.sh
PRE_COMMIT_HOOK := hk_vps_4/scripts/git-hooks/pre-commit

.PHONY: help upstream pin pin-update preflight preflight-test backup restore-drill secret-check hooks-install

help:
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*## "} {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

upstream: ## 首次/重建上游 clone（gitignored；新机器 bootstrap）
	git clone $(UPSTREAM_URL) ai-memory-mcp

pin: ## 打印版本契约（读 hk_vps_4/upstream.lock；零网络依赖）
	@grep -E '^(UPSTREAM_RELEASE_TAG|UPSTREAM_RELEASE_COMMIT|IMAGE_TAG|IMAGE_DIGEST_AMD64|IMAGE_DIGEST_VERIFIED_BY|VERIFIED_AT)=' $(LOCK)

pin-update: ## 重新校验上游并回写 upstream.lock（需网络；不部署）
	bash $(PREFLIGHT) --write-lock

preflight: ## 升级预检：准入判定 + CHANGELOG 摘要（追加 ARGS，如 ARGS=--with-image）
	bash $(PREFLIGHT) $(ARGS)

preflight-test: ## 预检脚本离线自测（fixture 驱动，无网络依赖）
	bash hk_vps_4/scripts/tests/run-fixtures.sh

backup: ## 备份并外迁：快照 → sha256 → ossutil 上传 → 回读比对（见 hk_vps_4/backup/）
	bash hk_vps_4/backup/backup-and-push.sh

restore-drill: ## 季度恢复演练（硬验收，可重复执行）
	bash hk_vps_4/backup/restore-drill.sh

secret-check: ## 扫描已跟踪文件中的公网 IP（真实值应放 secrets.local）
	bash $(SECRET_CHECK)

hooks-install: ## 安装 pre-commit 钩子到 .git/hooks/（不改 git config）
	install -m 0755 $(PRE_COMMIT_HOOK) .git/hooks/pre-commit
	@echo "已安装 pre-commit 钩子（扫描暂存区公网 IP）；可用 git commit --no-verify 绕过"
