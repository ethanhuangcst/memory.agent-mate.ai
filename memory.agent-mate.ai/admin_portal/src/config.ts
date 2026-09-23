/**
 * 门户配置：一次性读取环境变量并**严格校验**（缺键 fail-loud，不回落默认值掩盖配置缺失）。
 *
 * 键名与语义真源：specs/web-portal/web-design.md §12.9。
 * 语义校验（在解析之后，失败即拒绝启动）：
 *  1. `PORTAL_DB_PATH` 必须**不在 `/data` 下**（AC9.4 / TC-P-L3-08：门户库不得混入用户数据卷）；
 *  2. 管理面与 MCP 面的 Host 集合必须**不相交**（否则面隔离失去意义）；
 *  3. `PORTAL_ENV=production` ⇒ 必须配好 Cloudflare Access，且**禁止**任何非 Access 身份来源；
 *  4. 启用自签 JWT（测试通道）时，两个面都必须是回环地址（防误把测试后门带到真实域名）。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { isLoopbackHost, normalizeHostList } from './shared/host-split';

/** 仓库内 `admin_portal/` 目录（本文件位于 `<root>/src/config.ts`）。 */
export const ADMIN_PORTAL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export const LOCALES = ['en', 'zh-CN', 'zh-HK', 'zh-TW'] as const;
export type Locale = (typeof LOCALES)[number];

export type LogLevel =
  | 'fatal'
  | 'error'
  | 'warn'
  | 'info'
  | 'debug'
  | 'trace'
  | 'silent';

export interface AccessAuthConfig {
  /** 团队域（取 JWKS 与校验 iss），如 `<team>.cloudflareaccess.com`。 */
  readonly teamDomain: string;
  /** Access 应用的 Audience 标签（校验 aud）。 */
  readonly aud: string;
  /** JWKS 地址覆盖（默认由团队域推导）。 */
  readonly jwksUrl: string;
}

export interface TestJwtConfig {
  readonly enabled: boolean;
  /** 测试用 JWKS：本地文件路径或内联 JSON。 */
  readonly jwks: string;
  readonly iss: string;
  readonly aud: string;
}

export interface PortalConfig {
  readonly env: 'development' | 'production';
  readonly isProduction: boolean;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly adminHosts: string[];
  readonly mcpHosts: string[];
  readonly dbPath: string;
  readonly usersRoot: string;
  readonly staticRoot: string;
  readonly viewsRoot: string;
  readonly defaultLocale: Locale;
  readonly access: AccessAuthConfig;
  readonly testJwt: TestJwtConfig;
  /**
   * 开发期命令覆盖（`PORTAL_LAUNCH_OVERRIDE`）；`null` = 不覆盖（按内建模板执行）。
   * **生产环境下恒为 `null`** —— 出现该键即拒绝启动。
   */
  readonly launchOverride: string | null;
  /** 门户专用 MaaS key（spawn 上游会话时注入子进程）；未配置时为 `null`。 */
  readonly upstreamApiKey: string | null;
}

const RawEnvSchema = z.object({
  PORTAL_ENV: z.enum(['development', 'production']).default('development'),
  PORTAL_ADMIN_HOST: z.string().min(1),
  PORTAL_MCP_HOST: z.string().min(1),
  PORTAL_DB_PATH: z.string().min(1),
  PORTAL_PORT: z.coerce.number().int().min(1).max(65535).default(8788),
  PORTAL_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  PORTAL_I18N_DEFAULT: z.enum(LOCALES).default('zh-CN'),
  PORTAL_ACCESS_TEAM_DOMAIN: z.string().min(1).optional(),
  PORTAL_ACCESS_AUD: z.string().min(1).optional(),
  PORTAL_ACCESS_JWKS_URL: z.string().min(1).optional(),
  PORTAL_TEST_JWT_ENABLED: z.enum(['0', '1']).default('0'),
  PORTAL_TEST_JWT_JWKS: z.string().min(1).optional(),
  PORTAL_TEST_JWT_ISS: z.string().min(1).optional(),
  PORTAL_TEST_JWT_AUD: z.string().min(1).optional(),
  // 开发登录声明的**真实身份邮箱**（必须是 Cloudflare Access 策略里注册的那个邮箱）。
  // 门户自身不使用它，而是**必填校验**：缺它时启用自签通道即拒绝启动 ——
  // 这样就不可能出现「静默回落到某个测试邮箱」，即「不接受 admin@example.test 登录」的落地方式。
  PORTAL_TEST_JWT_EMAIL: z.string().min(1).optional(),
  PORTAL_USERS_ROOT: z.string().min(1).optional(),
  PORTAL_STATIC_ROOT: z.string().min(1).optional(),
  PORTAL_VIEWS_ROOT: z.string().min(1).optional(),
  // 开发期**命令覆盖**（接入批次 PSP-W2 起）：覆盖 launch 模板的「二进制那一段」，
  // 使门户能在 macOS 上以 docker exec 借壳执行 linux 上游二进制（本机跑不了它）。
  // **仅 development 生效**：production 下出现该键即拒绝启动（见下方语义校验），
  // 与自签 JWT / 开发登录入口的门控完全同构（配置门控 + 生产拒绝）。
  PORTAL_LAUNCH_OVERRIDE: z.string().min(1).optional(),
  // 门户**专用**的 MaaS key：spawn 上游会话时注入子进程（上游据此读 LLM / embeddings）。
  // 与主 key 同 workspace / 同模型权限 —— 否则 embeddings 模型或维度不一致会**静默降级**
  //（见 knowledge/web-portal/portal-launch-mechanism.md E4）。
  DASHSCOPE_API_KEY: z.string().min(1).optional(),
});

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/** `/data` 及其子路径判定（门户库不得落此，见 AC9.4）。 */
export function isUnderDataDir(target: string): boolean {
  const resolved = path.resolve(target);
  return resolved === '/data' || resolved.startsWith('/data/');
}

/** 推导 Cloudflare Access 的 JWKS 地址（团队域形如 `<team>.cloudflareaccess.com`）。 */
export function deriveJwksUrl(teamDomain: string): string {
  const trimmed = teamDomain.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `https://${trimmed}/cdn-cgi/access/certs`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PortalConfig {
  const parsed = RawEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`门户配置非法（缺键或取值不合法）：${formatIssues(parsed.error)}`);
  }
  const raw = parsed.data;

  const adminHosts = normalizeHostList(raw.PORTAL_ADMIN_HOST);
  const mcpHosts = normalizeHostList(raw.PORTAL_MCP_HOST);
  if (adminHosts.length === 0) throw new Error('PORTAL_ADMIN_HOST 解析后为空');
  if (mcpHosts.length === 0) throw new Error('PORTAL_MCP_HOST 解析后为空');

  const overlap = adminHosts.filter((host) => mcpHosts.includes(host));
  if (overlap.length > 0) {
    throw new Error(
      `管理面与 MCP 面的 Host 不得相同（面隔离判据失效）：${overlap.join(', ')}`,
    );
  }

  const dbPath = path.resolve(raw.PORTAL_DB_PATH);
  if (isUnderDataDir(dbPath)) {
    throw new Error(
      `PORTAL_DB_PATH 必须不在 /data 下（门户库与用户数据卷分离，AC9.4 / TC-P-L3-08）：${dbPath}`,
    );
  }

  const isProduction = raw.PORTAL_ENV === 'production';
  const testJwtEnabled = raw.PORTAL_TEST_JWT_ENABLED === '1';

  if (testJwtEnabled) {
    const missing = (
      [
        ['PORTAL_TEST_JWT_JWKS', raw.PORTAL_TEST_JWT_JWKS],
        ['PORTAL_TEST_JWT_ISS', raw.PORTAL_TEST_JWT_ISS],
        ['PORTAL_TEST_JWT_AUD', raw.PORTAL_TEST_JWT_AUD],
        ['PORTAL_TEST_JWT_EMAIL', raw.PORTAL_TEST_JWT_EMAIL],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`启用自签 JWT（PORTAL_TEST_JWT_ENABLED=1）时缺少：${missing.join(', ')}`);
    }
    if (isProduction) {
      throw new Error('production 环境禁止启用自签 JWT（PORTAL_TEST_JWT_ENABLED 必须为 0）');
    }
    const nonLoopback = [...adminHosts, ...mcpHosts].filter((host) => !isLoopbackHost(host));
    if (nonLoopback.length > 0) {
      throw new Error(
        `自签 JWT 仅允许在本机（回环）使用，检测到非回环 Host：${nonLoopback.join(', ')}`,
      );
    }
  }

  // 开发期命令覆盖：只允许 development，且不接受空白值（避免「看似配了、实际没生效」）。
  const rawOverride = raw.PORTAL_LAUNCH_OVERRIDE;
  const launchOverride = rawOverride === undefined ? null : rawOverride.trim();
  if (launchOverride !== null && launchOverride.length === 0) {
    throw new Error('PORTAL_LAUNCH_OVERRIDE 不能为空白字符串（要么不设，要么给完整命令前缀）');
  }
  if (isProduction && launchOverride !== null) {
    throw new Error(
      'production 环境禁止 PORTAL_LAUNCH_OVERRIDE：模板必须按内建常量执行（该键仅用于本机开发借壳）',
    );
  }

  const teamDomain = raw.PORTAL_ACCESS_TEAM_DOMAIN;
  const accessAud = raw.PORTAL_ACCESS_AUD;
  if (isProduction && (!teamDomain || !accessAud)) {
    throw new Error(
      'production 环境必须配置 Cloudflare Access：PORTAL_ACCESS_TEAM_DOMAIN 与 PORTAL_ACCESS_AUD 均为必填',
    );
  }

  const access: AccessAuthConfig = {
    teamDomain: teamDomain ?? '',
    aud: accessAud ?? '',
    jwksUrl: raw.PORTAL_ACCESS_JWKS_URL ?? (teamDomain ? deriveJwksUrl(teamDomain) : ''),
  };

  const testJwt: TestJwtConfig = {
    enabled: testJwtEnabled,
    jwks: raw.PORTAL_TEST_JWT_JWKS ?? '',
    iss: raw.PORTAL_TEST_JWT_ISS ?? '',
    aud: raw.PORTAL_TEST_JWT_AUD ?? '',
  };

  return {
    env: raw.PORTAL_ENV,
    isProduction,
    port: raw.PORTAL_PORT,
    logLevel: raw.PORTAL_LOG_LEVEL,
    adminHosts,
    mcpHosts,
    dbPath,
    usersRoot: path.resolve(raw.PORTAL_USERS_ROOT ?? '/data/users'),
    staticRoot: path.resolve(raw.PORTAL_STATIC_ROOT ?? path.join(ADMIN_PORTAL_ROOT, 'assets')),
    viewsRoot: path.resolve(raw.PORTAL_VIEWS_ROOT ?? path.join(ADMIN_PORTAL_ROOT, 'src', 'web', 'views')),
    defaultLocale: raw.PORTAL_I18N_DEFAULT,
    access,
    testJwt,
    launchOverride,
    upstreamApiKey: raw.DASHSCOPE_API_KEY ?? null,
  };
}
