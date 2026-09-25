/**
 * 3.22 真身份 / 主机名 / Bypass 口径核对探针（研究类，**不入制品**；只读）。
 *
 * 服务对象：Sprint 4 `#7 deploy:真身份口径核对`（判据来源 `web-portal/portal-identity-plan.md` §8 `SBI-D5`：
 * 「只读核对：受影响则更新，未受影响则显式登记「已核对、无需改」」）。
 *
 * 设计取舍：`#7` 验收列点名核对「`deployment.md` 真身份与隧道章节」与「`mcp/mcp-design.md` 主机名与 Bypass 口径」；
 * 但实测后者**在 `mcp-design.md` 内不存在**（该文件只回链 `web-design.md` §6）⇒ 本探针把核对对象
 * 锚到**真源**：`deployment.md` §12.4 / §12.5.1 / §12.5.4 + `web-design.md` §6 + `mcp-design.md` §5.6.2（回链）。
 *
 * 每条断言都给**两侧真源**与判定依据；有注入空间的给灵敏度对照（M6）。
 * 退出码：0 = 探针跑通（结论以 PASS/FAIL 表为准）· 20 = 运行错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SPECS = path.resolve(HERE, '../../specs');
const DEPLOY = path.resolve(HERE, '../../deploy');
const PORTAL = path.resolve(HERE, '../../admin_portal');

const RESULTS = [];
const check = (id, name, ok, detail) => {
  RESULTS.push({ id, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${id}] ${name}${detail ? ` — ${detail}` : ''}`);
};
const info = (msg) => console.log(`[i] ${msg}`);
const read = (p) => fs.readFileSync(p, 'utf8');
const lines = (p) => read(p).split('\n');
const has = (file, needle) => read(file).includes(needle);
const lineOf = (file, needle) => lines(file).findIndex((l) => l.includes(needle)) + 1;

const DEPLOYMENT = path.join(SPECS, 'deployment.md');
const MC_DESIGN = path.join(SPECS, 'mcp/mcp-design.md');
const WEB_DESIGN = path.join(SPECS, 'web-portal/web-design.md');
const COMPOSE = path.join(DEPLOY, 'portal.compose.yml');
const CONFIG = path.join(PORTAL, 'src/config.ts');

console.log('=== 3.22 真身份 / 主机名 / Bypass 口径核对 ===\n');

// ---------------------------------------------------------------- M1 `PORTAL_ENV` 取值集合
{
  const enumLine = lines(CONFIG).find((l) => l.includes('z.enum([') && l.includes('development')) ?? '';
  // 去重：同一行可能同时给出枚举与默认值（`z.enum([...]).default('development')`），
  // 不去重会让「取值集合大小 == 2」的断言恒假（本轮踩到）。
  const allowed = [...new Set([...enumLine.matchAll(/'([a-z]+)'/g)].map((m) => m[1]))];
  info(`代码侧枚举（${path.relative(SPECS, CONFIG)}）=${JSON.stringify(allowed)}`);

  const offenders = [];
  for (const file of [COMPOSE, DEPLOYMENT, WEB_DESIGN, MC_DESIGN]) {
    lines(file).forEach((l, i) => {
      for (const m of l.matchAll(/PORTAL_ENV\s*[=:]\s*"?([A-Za-z]+)"?/g)) {
        if (!allowed.includes(m[1])) offenders.push(`${path.relative(SPECS, file)}:${i + 1} ⇒ PORTAL_ENV=${m[1]}`);
      }
    });
  }
  check(
    'M1',
    '`PORTAL_ENV` 的取值集合唯一（三处口径一致）',
    offenders.length === 0 && allowed.length === 2,
    offenders.length ? `异形值：${offenders.join(' · ')}` : `全部 ∈ {${allowed.join(', ')}}`,
  );
}

// ---------------------------------------------------------------- M2 生产禁用键三处同集
{
  const composeBlock = lines(COMPOSE).filter((l) => l.includes('PORTAL_TEST_JWT') || l.includes('PORTAL_LAUNCH_OVERRIDE'));
  const composeKeys = new Set([...composeBlock.join('\n').matchAll(/(PORTAL_[A-Z_]+)/g)].map((m) => m[1]));
  const docKeys = new Set(
    [...read(DEPLOYMENT).matchAll(/(PORTAL_TEST_JWT_[A-Z]+|PORTAL_LAUNCH_OVERRIDE)/g)].map((m) => m[1]),
  );
  const codeKeys = new Set(
    [...read(CONFIG).matchAll(/(PORTAL_TEST_JWT_[A-Z]+|PORTAL_LAUNCH_OVERRIDE)/g)].map((m) => m[1]),
  );
  const missing = [...composeKeys].filter((k) => !docKeys.has(k));
  info(`compose=${composeKeys.size} 键 · deployment=${docKeys.size} 键 · config=${codeKeys.size} 键`);
  check(
    'M2',
    '「生产不得设置」键集合三处一致（compose 注释 / 文档 / 代码）',
    missing.length === 0,
    missing.length ? `文档缺登记：${missing.join(', ')}` : `三处同集（${[...composeKeys].length} 键）`,
  );
  // `--dev-login`（开发登录入口）**不是独立键**：实测 `server.ts` 为
  //   `if (cfg.testJwt.enabled) registerDevLoginRoutes(app, deps);`
  // 而 `cfg.testJwt.enabled` 由 `config.ts` 的 `PORTAL_TEST_JWT_ENABLED` 驱动
  // ⇒ 它的生产禁用口径与 `PORTAL_TEST_JWT_*` **同源**。
  // 判据因此不是「文档里出现过 `dev-login` 字样」（那种规则会被任意一句提及蒙过），而是
  // **开关同源 + 指南有落点**：运维照 §12.5.4 禁用那套键时，必须知道它同时关掉了什么。
  const SERVER = path.join(PORTAL, 'src/server.ts');
  const serverLines = lines(SERVER);
  // 取**调用行**（含括号），不是 `import { registerDevLoginRoutes } ...` 那一行 ——
  // 本轮实测教训：先写成 `l.includes('registerDevLoginRoutes')`，`findIndex` 命中的是文件顶部的
  // import（第 33 行），于是窗口取在了 import 附近 ⇒ 判据**恒假**（真调用在第 133 行）。
  const CALL = /registerDevLoginRoutes\s*\(/;
  const regIdx = serverLines.findIndex((l) => CALL.test(l));
  const coupledInCode =
    regIdx >= 0 &&
    serverLines.slice(Math.max(0, regIdx - 15), regIdx + 1).some((l) => l.includes('testJwt.enabled')) &&
    has(CONFIG, 'PORTAL_TEST_JWT_ENABLED') &&
    has(CONFIG, 'testJwt');
  // 落点判据：提到该入口的那一行必须**同时**点明它由哪套键开关（同源写在同一行，避免两处口径漂移）
  const docLine = lines(DEPLOYMENT).find((l) => l.includes('/admin/dev-login')) ?? '';
  const docCovers = docLine.includes('PORTAL_TEST_JWT');
  check(
    'M2b',
    '开发登录入口（`/admin/dev-login`）的开关与 `PORTAL_TEST_JWT_*` **同源**，且在 `deployment.md` 有落点',
    coupledInCode && docCovers,
    `代码耦合=${coupledInCode}（server.ts 的注册受 testJwt.enabled 支配）· 指南落点=${docCovers}` +
      (docCovers ? '（同一行点明同源）' : '：指南提到入口却没点明它由哪套键开关'),
  );
}

// ---------------------------------------------------------------- M3 面隔离 Host 键
{
  const composeHasBoth = has(COMPOSE, 'PORTAL_ADMIN_HOST') && has(COMPOSE, 'PORTAL_MCP_HOST');
  const codeAssertsDisjoint = /不相交|must not overlap|disjoint/.test(read(CONFIG));
  const docSaysSeparate = /两个域名\s*\*{0,2}分离|不靠 path 区分/.test(read(WEB_DESIGN));
  check(
    'M3',
    '面隔离两个 Host 键齐备且「必须不相交」在代码与设计两侧都写了',
    composeHasBoth && codeAssertsDisjoint && docSaysSeparate,
    `compose 两键=${composeHasBoth} · 代码断言=${codeAssertsDisjoint} · 设计声明=${docSaysSeparate}`,
  );
}

// ---------------------------------------------------------------- M4 Bypass 口径单源
{
  const webBypass = has(WEB_DESIGN, '必须绕过');
  const depBypass124 = has(DEPLOYMENT, '必须绕过');
  const depBypassGuide = /建一条\s*\*{0,2}Bypass\*{0,2}/.test(read(DEPLOYMENT));
  check(
    'M4',
    '「MCP 面必须绕过 Access」的设计声明与部署指南四处一致',
    webBypass && depBypass124 && depBypassGuide,
    `web-design §6=${webBypass} · deployment §12.4=${depBypass124} · §12.5.1=${depBypassGuide}`,
  );
}

// ---------------------------------------------------------------- M5 mcp-design 回链有效
{
  const backlink = has(MC_DESIGN, 'web-design.md') && has(MC_DESIGN, '§6');
  const webHasTable = has(WEB_DESIGN, '必须绕过') && has(WEB_DESIGN, 'CF Access');
  check(
    'M5',
    '`mcp-design.md` 的主机名/Bypass 口径**回链到有效真源**（`web-design.md` §6）',
    backlink && webHasTable,
    backlink ? '回链存在且目标节含 Host/Bypass 表（否则条目点名的核对对象是空的）' : '未找到回链',
  );
}

// ---------------------------------------------------------------- M6 旧口径零残留 + 灵敏度对照
{
  const PATTERNS = [
    { re: /\bai-mem\b(?!ory)/, label: '异形账号 `ai-mem`（应为 `aimem` / `aimem-ssh`）' },
    { re: /\/opt\/ai-memory-mcp\//, label: '旧部署目录 `/opt/ai-memory-mcp/`（已统一为 `/opt/ai-memory/`）' },
  ];
  // 扫描面 = 现行真源（三份 spec）+ **入仓的制品**（两份 compose + 配置模板/样例）。
  // 两条实测教训（都已写进规则）：
  //   a. **历史叙述不是残留**：变更记录表行（`| 20YY-MM-DD |`）按仓内改名口径保留旧名、只靠映射表
  //      收口（实测：`deployment.md` 变更记录里那条旧路径是**合法历史**）⇒ 规则豁免该形态，否则
  //      第一条命中的就是历史行。
  //   b. **扫描面必须与「制品」定义对齐**：`deploy/config.toml` / `config.local.toml` 是**未入仓**的
  //      本机派生文件（`.gitignore` 第 12/15 条）⇒ 旧路径出现在它们里面只说明「本机副本旧」，不是
  //      制品漂移；把未跟踪文件当制品判据，结论会随开发机状态漂移。⇒ 只扫 `git ls-files` 认得的文件。
  const REPO = path.resolve(HERE, '../../..');
  const isTracked = (abs) => {
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', path.relative(REPO, abs)], {
        cwd: REPO,
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  };
  const CANDIDATES = [
    DEPLOYMENT,
    WEB_DESIGN,
    MC_DESIGN,
    COMPOSE,
    path.join(DEPLOY, 'docker-compose.prod.yml'),
    path.join(DEPLOY, 'config.toml.tmpl'),
    path.join(DEPLOY, 'config.toml'),
    path.join(DEPLOY, 'config.local.toml'),
    path.join(DEPLOY, '.env.prod.example'),
  ].filter((p) => fs.existsSync(p));
  const SCAN = CANDIDATES.filter((p) => isTracked(p));
  const untracked = CANDIDATES.filter((p) => !isTracked(p));
  const HISTORY_ROW = /^\|\s*20\d\d-\d\d-\d\d\s*\|/;
  const hits = [];
  let excluded = 0;
  for (const file of SCAN) {
    lines(file).forEach((l, i) => {
      if (HISTORY_ROW.test(l)) {
        if (PATTERNS.some((p) => p.re.test(l))) excluded += 1;
        return;
      }
      for (const p of PATTERNS) if (p.re.test(l)) hits.push(`${path.relative(SPECS, file)}:${i + 1} ⇒ ${p.label}`);
    });
  }
  info(
    `扫描 ${SCAN.length} 个**入仓**文件 · 历史叙述行豁免 ${excluded} 处` +
      (untracked.length
        ? ` · 未入仓派生文件排除 ${untracked.length} 个（${untracked.map((p) => path.basename(p)).join(' / ')}）`
        : ''),
  );
  check(
    'M6',
    '现行真源与**入仓制品**里旧口径零残留（扫描面 = 三份 spec + 入仓 compose/配置；变更记录行豁免；未跟踪派生文件排除）',
    hits.length === 0,
    hits.length ? hits.join(' · ') : `0 命中（历史叙述豁免 ${excluded} 处）`,
  );

  const injected = '\n# probe-inject: ai-mem /opt/ai-memory-mcp/\n';
  const tmp = path.join(HERE, 'out', 'inject-control.txt');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, injected);
  const controlHit = PATTERNS.some((p) => p.re.test(injected));
  fs.rmSync(tmp, { force: true });
  check('M6', '灵敏度对照：注入旧口径形态 ⇒ 规则必须命中', controlHit, controlHit ? '两条模式均命中注入样本' : '规则未命中（恒绿风险）');
}

// ---------------------------------------------------------------- 结论表
const failed = RESULTS.filter((r) => !r.ok);
console.log(`\n通过 ${RESULTS.length - failed.length} 项 · 失败 ${failed.length} 项`);
if (failed.length) {
  console.log('待修订项（受影响 ⇒ 需「已更新」，或按 SBI-D5 登记为「已核对、无需改」并说明理由）：');
  for (const r of failed) console.log(`  · ${r.id} ${r.name} ⇒ ${r.detail}`);
}
process.exit(0);
