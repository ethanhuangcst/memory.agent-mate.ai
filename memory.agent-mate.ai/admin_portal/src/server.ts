/**
 * 门户进程装配：配置校验 → 启动自检 → 面隔离 → 身份守卫 → 静态资源 → 路由 → 监听。
 *
 * 关键安全决定：
 *  - **`trustProxy: false`**：面隔离判据是 **Host 头**，若信任 `X-Forwarded-Host`，
 *    客户端即可自称任意面从而绕过分面 ⇒ 一律以真实 `Host` 头判定（cloudflared 隧道会原样透传）。
 *  - 钩子顺序即防线顺序：**面隔离 → 身份 → 路由**；跨面请求不会进入验签，未认证请求不会进入路由。
 *  - 开发环境只绑回环；生产绑 `0.0.0.0`（容器内由外部反代/隧道接入）。
 *  - 迁移策略：开发环境启动时自动迁移（前向-only）；**生产环境要求 schema 已是最新**，
 *    落后即拒绝启动 —— 与 §3.4「版本断言」同源，避免陈旧进程操作未知 schema。
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type Database from 'better-sqlite3';
import { loadConfig, type PortalConfig } from './config';
import { openDatabase } from './web/db/connection';
import { currentVersion, migrate, pendingVersions } from './web/db/migrate';
import { hasBlockingFailure, runSelfCheck, summarizeSelfCheck } from './selfcheck';
import { decideRequest, HEALTH_PATH } from './shared/host-split';
import { redactText } from './shared/redact';
import { createRenderEnv } from './web/render';
import { createI18n } from './web/i18n';
import { registerAdminGuard } from './web/admin-guard';
import type { PageDeps } from './web/pages';
import { registerPublicRoutes } from './web/routes/index';
import { registerPlaceholderRoutes } from './web/routes/placeholder';
import { registerAdminUserRoutes } from './web/routes/admin-users';
import { registerAdminUserDetailRoutes } from './web/routes/admin-user-detail';
import { registerAdminApiRoutes } from './web/routes/admin-api';
import { registerDevLoginRoutes } from './web/routes/dev-login';
import { registerMcpBridgeRoutes } from './bridge/route';

export interface BuildOptions {
  /** 注入用（离线测试传内存库）；不传则由本函数按 `PORTAL_DB_PATH` 打开并负责关闭。 */
  readonly db?: Database.Database;
  /**
   * 接入面（`/mcp`）请求级转发的超时（毫秒）；默认见 `bridge/route.ts`。
   * **仅供测试注入短超时**（让「上游挂起 ⇒ 504」这条路径可被快速覆盖）。
   */
  readonly requestTimeoutMs?: number;
}

export async function buildServer(
  cfg: PortalConfig,
  options: BuildOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: cfg.logLevel,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["cf-access-client-secret"]',
        'req.headers["cf-access-jwt-assertion"]',
      ],
    },
    trustProxy: false,
    bodyLimit: 64 * 1024,
  });

  const env = createRenderEnv(cfg);
  // 词表键集合不一致会在这一步抛错（fail-loud）
  const i18n = createI18n(cfg);

  const ownsDb = options.db === undefined;
  const db = options.db ?? openDatabase(cfg.dbPath);
  if (ownsDb) {
    if (cfg.isProduction) {
      const pending = pendingVersions(db);
      if (pending.length > 0) {
        throw new Error(
          `门户库 schema 落后（待应用迁移：${pending.join(',')}）—— 生产环境须先执行迁移再启动`,
        );
      }
    } else {
      migrate(db);
    }
  }

  const deps: PageDeps = { cfg, i18n, env, db };

  // 表单体解析（Fastify 默认只解析 JSON；这里补 URL 编码，零额外依赖）
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      try {
        const out: Record<string, string> = {};
        for (const [key, value] of new URLSearchParams(body as string)) out[key] = value;
        done(null, out);
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  // ---- 面隔离：先判面再路由（fail-closed）----
  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0] ?? '/';
    const decision = decideRequest(request.headers.host, pathname, cfg);
    if (decision.allow) return;

    request.log.warn(
      { event: 'face_denied', face: decision.face, reason: decision.reason, path: pathname },
      'face_denied',
    );
    reply.code(403).type('text/plain; charset=utf-8');
    return reply.send('Forbidden: request host does not match this face.\n');
  });

  // ---- 身份：面判定之后的第二道门（仅管理面路径；失败即 401）----
  registerAdminGuard(app, deps);

  // ---- 开发登录入口：**仅在自签通道启用时注册**（其余配置下该路由不存在）----
  // 守卫已对该路径做前置放行（见 admin-guard.ts），否则「用来获得身份的页面」会先被拦成 401。
  if (cfg.testJwt.enabled) registerDevLoginRoutes(app, deps);

  // ---- 静态资源：仅由面判定放行后到达（assets 只属于管理面/公开面）----
  await app.register(fastifyStatic, {
    root: cfg.staticRoot,
    prefix: '/assets/',
    decorateReply: false,
    cacheControl: true,
    maxAge: cfg.isProduction ? '7d' : 0,
  });

  // ---- 探活：不承载机密，任何面放行（容器 healthcheck 直连回环）----
  app.get(HEALTH_PATH, async () => ({
    ok: true,
    batch: 'PSP-W1',
    schemaVersion: currentVersion(db),
    faces: { admin: cfg.adminHosts, mcp: cfg.mcpHosts },
  }));

  await registerPublicRoutes(app, deps);
  await registerPlaceholderRoutes(app, deps);
  await registerAdminUserRoutes(app, deps);
  await registerAdminUserDetailRoutes(app, deps);
  await registerAdminApiRoutes(app, deps);

  // ---- 接入面（MCP）：接管 `/mcp` ----
  // 面隔离钩子在前（`decideRequest` 只放行 MCP 面到该路径），因此这里只需处理令牌与会话；
  // 「管理域名上访问 /mcp」在到达本模块之前已被 403 拦下（面隔离先于身份）。
  registerMcpBridgeRoutes(
    app,
    options.requestTimeoutMs === undefined
      ? deps
      : { ...deps, requestTimeoutMs: options.requestTimeoutMs },
  );

  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0] ?? '/';
    reply.code(404);

    if (pathname.startsWith('/admin/api')) {
      return reply.type('application/json; charset=utf-8').send({ error: 'not_found', path: pathname });
    }
    if (pathname.startsWith('/admin') || pathname.startsWith('/assets')) {
      return reply.type('application/json; charset=utf-8').send({ error: 'not_found', path: pathname });
    }
    return reply.type('text/plain; charset=utf-8').send(`Not found: ${pathname}\n`);
  });

  app.addHook('onError', async (request, _reply, error) => {
    request.log.error(
      { event: 'request_error', path: request.url, message: redactText(error.message) },
      'request_error',
    );
  });

  app.addHook('onClose', async () => {
    if (ownsDb) db.close();
  });

  return app;
}

export function resolveBindHost(cfg: PortalConfig): string {
  return cfg.isProduction ? '0.0.0.0' : '127.0.0.1';
}

/* v8 ignore start —— 进程入口胶水，测试进程内不可执行：
   ① 执行它会真的绑定端口、注册 SIGINT/SIGTERM 处理；
   ② 其各段逻辑（loadConfig / runSelfCheck / hasBlockingFailure / buildServer / listen）
      已分别被单元测试与集成测试覆盖；
   ③ 本块不含业务判定，只有编排与「失败即置非零退出码」。
   因此显式豁免（非静默排除）：豁免范围到此块结束。 */
async function main(): Promise<void> {
  let cfg: PortalConfig;
  try {
    cfg = loadConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ event: 'config_invalid', message })}\n`);
    process.exitCode = 1;
    return;
  }

  const results = runSelfCheck(cfg);
  for (const item of results) {
    process.stdout.write(`${JSON.stringify({ event: 'selfcheck', ...item })}\n`);
  }
  if (hasBlockingFailure(results)) {
    process.stderr.write(
      `${JSON.stringify({ event: 'selfcheck_failed', summary: summarizeSelfCheck(results) })}\n`,
    );
    process.exitCode = 1;
    return;
  }

  let app: FastifyInstance;
  try {
    app = await buildServer(cfg);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ event: 'startup_failed', message })}\n`);
    process.exitCode = 1;
    return;
  }

  const host = resolveBindHost(cfg);
  await app.listen({ port: cfg.port, host });
  app.log.info(
    { event: 'portal_listening', host, port: cfg.port, env: cfg.env, views: path.basename(cfg.viewsRoot) },
    'portal_listening',
  );

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().then(() => {
        process.exit(0);
      });
    });
  }
}

const entry = process.argv[1];
if (entry && pathToFileURL(entry).href === import.meta.url) {
  void main();
}
/* v8 ignore stop */
