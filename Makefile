# memory.agent-mate.ai — 部署资产仓（公开）
# 上游 ai-memory clone 位于 ./ai-memory-mcp/（gitignored，只读约定）
# 详见 hk_vps_4/docs/asset_isolation_plan.md 与 hk_vps_4/docs/dev-plan.md

UPSTREAM_URL := https://github.com/alphaonedev/ai-memory-mcp.git

.PHONY: help upstream pin backup restore-drill

help:
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*## "} {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

upstream: ## 首次/重建上游 clone（gitignored；新机器 bootstrap）
	git clone $(UPSTREAM_URL) ai-memory-mcp

pin: ## 打印当前上游 tag/commit（回填 hk_vps_4/deploy/deployment-plan.md 的版本映射）
	@cd ai-memory-mcp && git describe --tags --always 2>/dev/null || git rev-parse --short HEAD

backup: ## 备份并外迁：快照 → sha256 → ossutil 上传 → 回读比对（见 hk_vps_4/backup/）
	bash hk_vps_4/backup/backup-and-push.sh

restore-drill: ## 季度恢复演练（硬验收，可重复执行）
	bash hk_vps_4/backup/restore-drill.sh
