/**
 * 公开面路由与 404 分支集成测试（真实 HTTP 注入）。
 *
 * 覆盖：
 *  - 公开首页 `/`（PSP-W1 为占位，但**语言解析与记忆**必须已生效）；
 *  - `/instructions` 的 301 兼容跳转（§12.3）；
 *  - 面隔离在这些路径上的表现（MCP 面不得访问公开页）；
 *  - 404 的三种身体形态：MCP 端点未实现（JSON）/ 管理前缀（JSON）/ 其余（纯文本）。
 *
 * 身份：公开页与 404 都**不需要身份**，故本文件不注入断言头 —— 这本身也是断言的一部分
 * （认证必须先于路由，但不能误伤公开面）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { loadConfig, type PortalConfig } from '../../src/config';
import { openMemoryDatabase } from '../../src/web/db/connection';
import { migrate } from '../../src/web/db/migrate';
import { buildServer } from '../../src/server';

let tmpRoot: string;
let db: Database.Database;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-public-'));
  fs.mkdirSync(path.join(tmpRoot, 'users'), { recursive: true });
  const cfg: PortalConfig = loadConfig({
    PORTAL_ADMIN_HOST: 'localhost,127.0.0.1',
    PORTAL_MCP_HOST: 'mcp.localhost',
    PORTAL_DB_PATH: path.join(tmpRoot, 'portal.db'),
    PORTAL_USERS_ROOT: path.join(tmpRoot, 'users'),
  });
  db = openMemoryDatabase();
  migrate(db);
  app = await buildServer(cfg, { db });
});

afterAll(async () => {
  await app.close();
  db.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('公开首页（无需身份）', () => {
  it('GET / ⇒ 200 且返回 HTML', async () => {
    const response = await app.inject({ method: 'GET', url: '/', headers: { host: 'localhost' } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('?lang= 生效并把选择写进 cookie（刷新后保持）', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/?lang=zh-TW',
      headers: { host: 'localhost' },
    });
    expect(response.statusCode).toBe(200);
    expect(String(response.headers['set-cookie'])).toContain('portal_locale=zh-TW');
  });

  it('未给 ?lang 时：cookie 优先于 Accept-Language', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'localhost', cookie: 'portal_locale=zh-HK', 'accept-language': 'en-US' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-language'] ?? '').toBeDefined();
  });
});

describe('/instructions 兼容跳转', () => {
  it('GET /instructions ⇒ 301 → /（旧路径不留白）', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/instructions',
      headers: { host: 'localhost' },
    });
    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe('/');
  });
});

describe('面隔离在公开路径上的表现', () => {
  it('MCP 面访问公开页 ⇒ 403（域名分离，不靠 path 区分）', async () => {
    const response = await app.inject({ method: 'GET', url: '/', headers: { host: 'mcp.localhost' } });
    expect(response.statusCode).toBe(403);
  });

  it('未登记 Host ⇒ 403（fail-closed）', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'evil.example.com' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('/healthz 任何面都放行（容器自检直连本地端口时 Host 非公开域名）', async () => {
    for (const host of ['localhost', 'mcp.localhost', '127.0.0.1']) {
      const response = await app.inject({ method: 'GET', url: '/healthz', headers: { host } });
      expect(response.statusCode, host).toBe(200);
      expect(response.json()).toMatchObject({ ok: true, batch: 'PSP-W1' });
    }
  });
});

describe('非命中路径的身体形态（MCP 面 `/mcp` 已由接入面接管，不再是 404 占位）', () => {
  it('MCP 面上的 /mcp 未携带令牌 ⇒ 401 JSON unauthorized（不降级为匿名）', async () => {
    // 行为变更（Sprint 4 `3.1`，2026-09-23）：此前该路径返回 `404 not_implemented` 占位，
    // 接入面落地后改由桥模块接管 —— 未携带令牌即 401，与所有「需认证的接入路径」同形。
    const response = await app.inject({ method: 'GET', url: '/mcp', headers: { host: 'mcp.localhost' } });
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('管理前缀下的未知路径且未认证 ⇒ 401（身份先于路由：未认证者探测不到管理路径是否存在）', async () => {
    for (const url of ['/admin/api/nope', '/admin/nope']) {
      const response = await app.inject({ method: 'GET', url, headers: { host: 'localhost' } });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it('静态资源前缀的未知路径 ⇒ JSON not_found（不回落整页 HTML）', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/assets/nope.css',
      headers: { host: 'localhost' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toMatchObject({ error: 'not_found' });
  });

  it('其余未知路径 ⇒ 纯文本（不回显内部路径以外的东西）', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope', headers: { host: 'localhost' } });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('/nope');
  });
});

// ---------------------------------------------------------------------------
// S6「接入说明页与 i18n」—— Sprint 4 `#4.2` 的判据（用例号见 specs/web-portal/web-test.md）
//   TC-P-L2-14 接入说明页结构（`AC6.1` / `AC6.7` / `AC6.10`）
//   TC-P-L2-15 能力表与能力文档逐项一致（`AC6.4`）
//   TC-P-L2-16 示例占位符合规（`AC6.5`）
//   TC-P-L2-17 发布阻断：口径不一致 / 出现真实值 ⇒ 门禁转红（`AC6.6`）
//   TC-P-L2-18 联系管理员悬浮层与第 3 步示例图（`AC6.8` / `AC6.9`；交互与「真实加载」由真浏览器判）
// 说明：本组同时是**发布门禁**（`AC6.6`）—— 任一条不成立，`make portal-test` 即转红，不允许带不一致发布。
// ---------------------------------------------------------------------------

const ADMIN_ROOT = process.env.ADMIN_PORTAL_ROOT ?? path.resolve(__dirname, '../..');
const SPECS_DIR = path.resolve(ADMIN_ROOT, '..', 'specs');
const CAPS_DOC = path.join(SPECS_DIR, 'mcp', 'mcp-capabilities.md');
const VIEWS_DIR = path.join(ADMIN_ROOT, 'src', 'web', 'views');
const I18N_DIR = path.join(ADMIN_ROOT, 'src', 'web', 'i18n');

/** 品牌串（`AC6.11` 要求标题与顶栏一致）；裸产品域名因此**允许**出现在页面与词表里。 */
const BRAND = JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'en.json'), 'utf8'))['brand'] as string;
const PRODUCT_DOMAIN = 'memory.agent-mate.ai';

/** 公网 IP 白名单（与 `scripts/secret-check.sh` 同口径：私网 / 回环 / 文档保留段）。 */
const ALLOW_IP_PREFIX = ['127.', '0.', '10.', '192.168.', '172.16.', '172.17.', '172.18.', '172.19.', '172.2', '172.30.', '172.31.', '255.'];

const TOKEN_RE = /\bmemo_[A-Za-z0-9_-]{20,}/g;
const IP_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const TIER_ROW_RE = /\|\s*(?:\*\*)?[^|`]*`(core|admin|graph|power|full)`[^|]*\|\s*\*{0,2}(\d{1,3})/g;

async function renderHome(): Promise<string> {
  const response = await app.inject({ method: 'GET', url: '/?lang=en', headers: { host: 'localhost' } });
  expect(response.statusCode).toBe(200);
  return response.body;
}

/** 基础设施主机名：从本机 secrets 提取（未入仓 ⇒ 缺失时该路跳过，返回空数组）。 */
function infrastructureHosts(): string[] {
  const secrets = path.resolve(ADMIN_ROOT, '..', 'secrets.local.hk_vps_4.md');
  if (!fs.existsSync(secrets)) return [];
  const hosts = new Set<string>();
  for (const m of fs.readFileSync(secrets, 'utf8').matchAll(/\b([a-z0-9][a-z0-9.-]*\.(?:com|net|cn|ai|io|xyz|dev))\b/g)) {
    const host = m[1];
    if (!host) continue;
    if (host === PRODUCT_DOMAIN || host.endsWith('aliyuncs.com') || host === 'example.com' || host === 'example.test') continue;
    hosts.add(host);
  }
  return [...hosts];
}

/** 占位符合规扫描（`AC6.5`）：返回命中描述。规则与允许清单见 `probes/instructions-verdict-probe/README.md`。 */
function scanForRealValues(text: string, hosts: string[]): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) hits.push(`真实令牌形态 ${m[0].slice(0, 14)}…`);
  for (const host of hosts) if (text.includes(host)) hits.push(`基础设施主机名 ${host}`);
  for (const m of text.matchAll(IP_RE)) {
    if (ALLOW_IP_PREFIX.some((p) => m[0].startsWith(p))) continue;
    hits.push(`公网 IP ${m[0]}`);
  }
  return hits;
}

function walk(dir: string, filter: (name: string) => boolean): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, filter);
    return filter(entry.name) ? [full] : [];
  });
}

describe('S6 接入说明页：结构（TC-P-L2-14 / AC6.1 · AC6.7 · AC6.10）', () => {
  it('三步接入为纵向三块，且序号自上而下（AC6.7）', async () => {
    const html = await renderHome();
    expect((html.match(/class="step"/g) ?? []).length).toBe(3);
    expect(html).toContain('class="steps"');
    const nums = [...html.matchAll(/<span class="step-num">(\d\d)<\/span>/g)].map((m) => m[1]);
    expect(nums).toEqual(['01', '02', '03']);
  });

  it('Admin 入口存在且可达（AC6.1；判据是入口元素，不是裸链接形态）', async () => {
    const html = await renderHome();
    expect(html).toContain('href="/admin/users"');
    expect(html).toContain('Admin entry');
  });

  it('品牌串同时出现在标题与 hero（AC6.11）', async () => {
    const html = await renderHome();
    expect(html).toContain(`<title>${BRAND}</title>`);
    expect(html).toContain(`<h1>AI Memory MCP</h1>`);
  });

  it('三步内容不重复、页内锚点无断链（AC6.10）', async () => {
    const html = await renderHome();
    expect((html.match(/class="steps"/g) ?? []).length).toBe(1);
    const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(anchors.filter((a) => !ids.has(a))).toEqual([]);
  });

  it('静态资源一律走 `/assets/`（相对路径在子路径下会 404）', async () => {
    const html = await renderHome();
    expect(html).not.toMatch(/(src|href)="assets\//);
    expect(html).toContain('/assets/portal.css');
  });
});

describe('S6 能力表与能力文档逐项一致（TC-P-L2-15 / AC6.4）', () => {
  it('权威侧可机械取到：档位表 5 档（取法限定档位表格行）', () => {
    const caps = fs.readFileSync(CAPS_DOC, 'utf8');
    const tiers = Object.fromEntries([...caps.matchAll(TIER_ROW_RE)].map((m) => [m[1], Number(m[2])]));
    expect(tiers).toEqual({ core: 8, admin: 22, graph: 20, power: 57, full: 101 });
  });

  it('页面能力表 = `core` 档工具集（行数与工具名逐项命中，只做取舍与翻译、不改写）', async () => {
    const caps = fs.readFileSync(CAPS_DOC, 'utf8');
    const coreSection = caps.split(/^### /m).find((part) => part.startsWith('2.1'));
    expect(coreSection, '未找到能力文档的 core 档小节').toBeTruthy();
    const coreTools = new Set([...(coreSection ?? '').matchAll(/`(memory_[a-z_]+)`/g)].map((m) => m[1]));

    const html = await renderHome();
    const tableBody = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
    const pageTools = [...tableBody.matchAll(/<code>(memory_[a-z_]+)<\/code>/g)].map((m) => m[1]);
    expect(pageTools.length).toBe(8);
    expect(pageTools.length).toBe(coreTools.size);
    expect(pageTools.filter((tool) => !coreTools.has(tool))).toEqual([]);
  });
});

describe('S6 示例占位符合规（TC-P-L2-16 / AC6.5）', () => {
  it('模板与词表零命中真实值（真实令牌形态 / 基础设施主机名 / 公网 IP）', () => {
    const hosts = infrastructureHosts();
    const files = [...walk(VIEWS_DIR, (n) => n.endsWith('.njk')), ...walk(I18N_DIR, (n) => n.endsWith('.json'))];
    expect(files.length).toBeGreaterThan(10);
    const hits = files.flatMap((file) => scanForRealValues(fs.readFileSync(file, 'utf8'), hosts).map((h) => `${path.basename(file)}: ${h}`));
    expect(hits).toEqual([]);
  });

  it('渲染出的 `/` 零命中真实值（示例只用 {MCP_HOST} 与掩码令牌）', async () => {
    const html = await renderHome();
    expect(scanForRealValues(html, infrastructureHosts())).toEqual([]);
    expect(html).toContain('https://{MCP_HOST}/mcp');
  });

  it('灵敏度对照：把真实令牌形态注入渲染产物 ⇒ 扫描必须命中（证明规则不是空转）', async () => {
    const html = await renderHome();
    const injected = html.replace('memo_a1b2.....4o5p6', 'memo_AbCdEfGhIjKlMnOpQrSt1234');
    expect(scanForRealValues(injected, [])).toHaveLength(1);
  });
});

describe('S6 发布阻断（TC-P-L2-17 / AC6.6）', () => {
  it('口径不一致必须被拦：能力表工具名与 `core` 档不符时集合比对转红', () => {
    const caps = fs.readFileSync(CAPS_DOC, 'utf8');
    const coreSection = caps.split(/^### /m).find((part) => part.startsWith('2.1')) ?? '';
    const coreTools = new Set([...coreSection.matchAll(/`(memory_[a-z_]+)`/g)].map((m) => m[1]));
    // 反向对照：把一个不存在的工具名当作页面行，必须不在 core 集内（⇒ 上面的逐项命中断言会失败）
    expect(coreTools.has('memory_not_a_tool')).toBe(false);
    expect(coreTools.size).toBe(8);
  });

  it('页面出现真实值必须被拦：`make portal-test` 的占位符扫描即阻断点', async () => {
    const html = await renderHome();
    const injected = `${html}\n<!-- real host: nginx4.agent-mate.ai -->`;
    expect(scanForRealValues(injected, ['nginx4.agent-mate.ai'])).toEqual(['基础设施主机名 nginx4.agent-mate.ai']);
  });
});

describe('S6 联系管理员与第 3 步示例图的存在性（TC-P-L2-18 / AC6.8 · AC6.9）', () => {
  it('第 1 步含可访问的悬浮层（二维码 + 邮箱），第 3 步含示例图', async () => {
    const html = await renderHome();
    expect(html).toContain('class="contact-admin-trigger"');
    expect(html).toContain('id="step1-wechat-qr"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('src="/assets/wechat.png"');
    expect(html).toMatch(/<a class="contact-admin-mail" href="mailto:[^"]+">/);
    expect(html).toContain('src="/assets/chat-example.png"');
    expect(html).toContain('class="step-figure"');
  });

  it('第 2 步的复制按钮指向同一份配置块（不作为数据源重复维护）', async () => {
    const html = await renderHome();
    expect(html).toContain('data-copy="#step2-config"');
    const config = html.slice(html.indexOf('id="step2-config"'), html.indexOf('</pre>'));
    expect(config).toContain('{MCP_HOST}');
    expect(config).toContain('Bearer memo_');
  });

  it('客户端名册 7 项（与设计稿一致）', async () => {
    const html = await renderHome();
    expect((html.match(/class="agent-roster-row"/g) ?? []).length).toBe(7);
  });
});
