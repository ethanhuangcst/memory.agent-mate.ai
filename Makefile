# memory.agent-mate.ai — 部署资产仓（公开）
# 上游 ai-memory clone 位于 ./ai-memory-mcp/（gitignored，只读约定）
# 版本契约（上游 tag / 镜像指纹）的单一真相源：memory.agent-mate.ai/upstream.lock
# 详见 memory.agent-mate.ai/specs/asset_isolation_plan.md 与 memory.agent-mate.ai/specs/dev-plan.md

UPSTREAM_URL := https://github.com/alphaonedev/ai-memory-mcp.git
LOCK := memory.agent-mate.ai/upstream.lock
PREFLIGHT := memory.agent-mate.ai/scripts/upstream-preflight.sh
SECRET_CHECK := memory.agent-mate.ai/scripts/secret-check.sh
PRE_COMMIT_HOOK := memory.agent-mate.ai/scripts/git-hooks/pre-commit
LINK_CHECK := memory.agent-mate.ai/scripts/link-check.sh
ATTEST_CHECK := memory.agent-mate.ai/scripts/attestation-paths-check.sh
MAINTAIN := memory.agent-mate.ai/scripts/maintain-user-dbs.sh

.PHONY: help upstream pin pin-update preflight preflight-test backup restore-drill secret-check doc-links attestation-paths maintain-user-dbs hooks-install

help:
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*## "} {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

upstream: ## 首次/重建上游 clone（gitignored；新机器 bootstrap）
	git clone $(UPSTREAM_URL) ai-memory-mcp

pin: ## 打印版本契约（读 memory.agent-mate.ai/upstream.lock；零网络依赖）
	@grep -E '^(UPSTREAM_RELEASE_TAG|UPSTREAM_RELEASE_COMMIT|IMAGE_TAG|IMAGE_DIGEST_AMD64|IMAGE_DIGEST_VERIFIED_BY|VERIFIED_AT)=' $(LOCK)

pin-update: ## 重新校验上游并回写 upstream.lock（需网络；不部署）
	bash $(PREFLIGHT) --write-lock

preflight: ## 升级预检：准入判定 + CHANGELOG 摘要（追加 ARGS，如 ARGS=--with-image）
	bash $(PREFLIGHT) $(ARGS)

preflight-test: ## 预检脚本离线自测（fixture 驱动，无网络依赖）
	bash memory.agent-mate.ai/scripts/tests/run-fixtures.sh

backup: ## 备份并外迁：快照 → sha256 → ossutil 上传 → 回读比对（见 memory.agent-mate.ai/backup/）
	bash memory.agent-mate.ai/backup/backup-and-push.sh

restore-drill: ## 季度恢复演练（硬验收，可重复执行）
	bash memory.agent-mate.ai/backup/restore-drill.sh

secret-check: ## 扫描已跟踪文件中的公网 IP（真实值应放 secrets.local）
	bash $(SECRET_CHECK)

doc-links: ## 校验仓内 md 相对链接无悬空（防「删文档留悬空引用」复发）
	bash $(LINK_CHECK)

attestation-paths: ## 静态校验 attestation 五路径口径一致（compose ×2 / SSH / 门户 / 每库维护命令）且无失准表述回流
	bash $(ATTEST_CHECK)

maintain-user-dbs: ## 逐库维护每用户库（gc + curator；宿主机 cron 入口，追加 ARGS 如 ARGS=--dry-run）
	bash $(MAINTAIN) $(ARGS)

hooks-install: ## 安装 pre-commit 钩子到 .git/hooks/（不改 git config）
	install -m 0755 $(PRE_COMMIT_HOOK) .git/hooks/pre-commit
	@echo "已安装 pre-commit 钩子（扫描暂存区公网 IP）；可用 git commit --no-verify 绕过"
