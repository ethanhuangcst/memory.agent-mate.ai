# memory.agent-mate.ai — 部署资产仓（公开）
# 上游 ai-memory clone 位于 ./ai-memory-mcp/（gitignored，只读约定）
# 版本契约（上游 tag / 镜像指纹）的单一真相源：memory.agent-mate.ai/upstream.lock
# 详见 memory.agent-mate.ai/specs/architecture.md（§5 资产边界）与 memory.agent-mate.ai/specs/deployment.md（§3 部署 / §9 升级）

UPSTREAM_URL := https://github.com/alphaonedev/ai-memory-mcp.git
LOCK := memory.agent-mate.ai/upstream.lock
PREFLIGHT := memory.agent-mate.ai/scripts/upstream-preflight.sh
SECRET_CHECK := memory.agent-mate.ai/scripts/secret-check.sh
PRE_COMMIT_HOOK := memory.agent-mate.ai/scripts/git-hooks/pre-commit
LINK_CHECK := memory.agent-mate.ai/scripts/link-check.sh
ATTEST_CHECK := memory.agent-mate.ai/scripts/attestation-paths-check.sh
MAINTAIN := memory.agent-mate.ai/scripts/maintain-user-dbs.sh
PORTAL_DEV := memory.agent-mate.ai/scripts/portal-dev.sh
PORTAL_TEST := memory.agent-mate.ai/scripts/portal-test.sh
PORTAL_E2E := memory.agent-mate.ai/scripts/portal-e2e.sh
PORTAL_TUNNEL := memory.agent-mate.ai/scripts/tunnel-dev.sh
PORTAL_COVERAGE := memory.agent-mate.ai/scripts/portal-coverage.sh
PORTAL_MCP_PROBE := memory.agent-mate.ai/scripts/probes/portal-mcp-probe.sh
PORTAL_MCP_SESSION_PROBE := memory.agent-mate.ai/scripts/probes/portal-mcp-session-probe.sh
PORTAL_ACCEPTANCE := memory.agent-mate.ai/scripts/portal-acceptance.sh
PORTAL_IMAGE_BUILD := memory.agent-mate.ai/scripts/build-portal-image.sh
DEPLOY_GUIDE_AUDIT := memory.agent-mate.ai/probes/deploy-guide-audit/probe.mjs
# 本机快速路径的环境文件（回环 Host + PORTAL_TEST_JWT_EMAIL），已 gitignore。
PORTAL_LOCAL_ENV := memory.agent-mate.ai/admin_portal/.env.local

.PHONY: help upstream pin pin-update preflight preflight-test backup restore-drill secret-check doc-links attestation-paths maintain-user-dbs hooks-install up down portal-up portal-down portal-dev portal-test portal-e2e portal-tunnel portal-coverage portal-image portal-mcp-probe portal-mcp-session-probe portal-acceptance

help:
	@grep -E '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*## "} {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

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

# 启动/停止的短别名。命名沿用既有 portal-* 家族，但日常只打 make up / make down。
# 注意：make 会把任何非零退出码**压平为 2**，脚本自己的退出码契约（portal-dev.sh 头部：
#   0/10/20/30）在 make 层看不到 —— 需要按码分流时直接调脚本。这一点刻意写在这里，
#   免得有人以为「make 返回 0/2」就是脚本的契约。
up: portal-up ## 同 portal-up（快捷键：make up）
down: portal-down ## 同 portal-down（快捷键：make down）

portal-up: ## 【日常入口】一条命令启动本机门户（.env.local + 自签登录；ARGS=--watch 自动重启）
	@[ -f $(PORTAL_LOCAL_ENV) ] || { \
	  echo "ERROR: 缺少 $(PORTAL_LOCAL_ENV)" >&2; \
	  echo "       先准备本机回环配置：cp memory.agent-mate.ai/admin_portal/.env.example $(PORTAL_LOCAL_ENV)" >&2; \
	  echo "       需要 PORTAL_ADMIN_HOST/MCP_HOST 为回环，并设置 PORTAL_TEST_JWT_EMAIL（开发登录身份）" >&2; \
	  exit 30; }
	@echo "  → 环境文件: $(PORTAL_LOCAL_ENV)（回环 Host，自签登录通道）"
	@echo "  → 停止：前台 Ctrl+C；若在后台跑，用 make portal-down"
	bash $(PORTAL_DEV) --env-file $(PORTAL_LOCAL_ENV) --dev-login $(ARGS)

portal-down: ## 停止本机门户（端口默认取 .env.local 的 PORTAL_PORT；可用 PORT=8794 指定）
	@command -v lsof >/dev/null 2>&1 || { echo "ERROR: 未找到 lsof，无法定位监听进程" >&2; exit 20; }
	@port="$(PORT)"; \
	if [ -z "$$port" ]; then \
	  port=$$(sed -n 's/^PORTAL_PORT=\([0-9][0-9]*\).*/\1/p' $(PORTAL_LOCAL_ENV) 2>/dev/null | tail -1); \
	fi; \
	port=$${port:-8788}; \
	pids=$$(lsof -nP -iTCP:$$port -sTCP:LISTEN -t 2>/dev/null); \
	if [ -z "$$pids" ]; then echo "  端口 $$port 上没有监听进程（无需停止）"; exit 0; fi; \
	echo "  端口 $$port 的监听进程："; \
	lsof -nP -iTCP:$$port -sTCP:LISTEN 2>/dev/null | sed -n '2,6p' | sed 's/^/    /'; \
	kill $$pids 2>/dev/null && echo "  已发送 SIGTERM：$$(echo $$pids | tr '\n' ' ')"; \
	sleep 1; \
	if lsof -nP -iTCP:$$port -sTCP:LISTEN -t >/dev/null 2>&1; then \
	  echo "  仍在运行：$$(lsof -nP -iTCP:$$port -sTCP:LISTEN -t | tr '\n' ' ')（可再执行一次，或手动 kill -9）"; \
	else echo "  已停止"; fi

portal-dev: ## 门户启动的底层入口（默认加载 .env 即真实域名配置；本机日常请用 portal-up）
	bash $(PORTAL_DEV) $(ARGS)

portal-test: ## 门户离线测试（类型检查 + 单元/集成；零网络依赖）
	bash $(PORTAL_TEST)

portal-e2e: ## 门户端到端（离线自签 JWT；追加 ARGS=--online 走隧道 + Service Token）
	bash $(PORTAL_E2E) $(ARGS)

portal-tunnel: ## Cloudflare 隧道就绪检查与配置清单（只读，不改任何配置）
	bash $(PORTAL_TUNNEL) $(ARGS)

portal-mcp-probe: ## 接入面真上游端到端探针（Sprint 4 `3.1`；用容器里的 ai-memory 验 /mcp 全链路）
	bash $(PORTAL_MCP_PROBE) $(ARGS)

portal-mcp-session-probe: ## 接入面会话隔离真上游端到端（Sprint 4 `3.3`；两会话两进程 + 无他人痕迹 + 接管不伤第三方）
	bash $(PORTAL_MCP_SESSION_PROBE) $(ARGS)

portal-acceptance: ## 本地完整集成验收收口入口（Sprint 4 `#8`：离线全绿 + L2 + L3 隔离 + 四条真上游判据 + 逐条结论表）
	bash $(PORTAL_ACCEPTANCE)

portal-image: ## 构建门户镜像（Sprint 5 `#1`：buildx + linux/amd64，tag 由 upstream.lock 注入；ARGS=--print-only 只打印命令）
	bash $(PORTAL_IMAGE_BUILD) $(ARGS)

deploy-doc-audit: ## 上线配置指南与真源的一致性审计（Sprint 4 `4.4`/`3.16`；零依赖、纯静态）
	node $(DEPLOY_GUIDE_AUDIT)

portal-coverage: ## 门户覆盖率（v8；阈值低于即失败；产物入 gitignored 的 admin_portal/coverage/）
	bash $(PORTAL_COVERAGE) $(ARGS)
