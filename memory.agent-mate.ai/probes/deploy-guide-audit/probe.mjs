#!/usr/bin/env node
/**
 * `3.16` 探针（**研究类，不入制品**）：为 Sprint 4 `4.4`「deploy:上线配置指南」把「**可照做**」
 * 这条验收条件变成**可机械判定**的东西。
 *
 * ## 为什么单列（覆盖核对的依据）
 *
 * `4.4` 的验收条件是「三段指南齐备 + **每步验证点** + **可照做**」—— 文档不能被执行，
 * 于是「可照做」最容易被写成一句**无法证伪**的话。但对一份**配置类**指南，「照做会得到什么」
 * 里有一大半是**机械可判**的：
 *
 *   Q1 指南要求读者填的键，与**代码真正会读**的键，是不是同一套？（漏一个 ⇒ 读者照做后**静默失败**）
 *   Q2 指南里引用的**文件路径**是不是都存在？（`../deploy/.env.prod.example` 这类）
 *   Q3 指南自己承诺过的「**逐键一致**」（`deployment.md` §5.4 与 `../deploy/.env.prod.example`）成不成立？
 *   Q4 指南提到的键里，有没有**真源已经不认**的（陈旧 / 误导）？
 *
 * ## 三侧真源（本探针的比对面）
 *
 *   · **代码侧**：`admin_portal/src/**` 里**真读取**的 `PORTAL_*` 键 —— 门户**真正会读**的那一套；
 *     口径（2026-09-25 收窄）：只认三种**真读取**形态 —— ① zod schema 键 `PORTAL_X:` ② `raw.X`
 *     ③ `process.env.X`。旧口径是扫源码**全文**抽键，会把**注释 / 字符串里的将来键名**也算成
 *     「会读的键」⇒ `A2` 假红（实测：`PORTAL_CONTACT_EMAIL` 只在注释里出现，却让门禁在 HEAD 上红）；
 *     「靠改注释消红」这个反向风险由 `A2b`（未解释令牌 + 带理由白名单 + 陈旧白名单检查）兜住。
 *   · **部署侧**：`deploy/docker-compose.prod.yml` + `deploy/*.env*.example` 里定义的键 —— 运维**真正会填**的那一套；
 *   · **文档侧**：`specs/deployment.md` + `deploy/README.md` 里出现的全大写键 —— 指南**要求读者知道**的那一套。
 *
 * ## 判据口径
 *
 *   · `[A*]` = **断言**（决定退出码）：三侧都抽到非空（`A1`）· 会读的键都被登记（`A2`）· `raw.X`
 *     引用都有 schema 声明（`A2a`）· 源码里出现的每个 `PORTAL_*` 令牌都被解释（`A2b`）· 指南引用的
 *     路径都存在（`A3`）· §5.4 的「逐键一致」成立（`A4`）· compose 结构底线（`A5`）；
 *   · `[S*]` = **判据自检**（决定退出码）：注入样本验「三种真读取形态**抽得到**」（`S1`，防假红）与
 *     「注释里的键名**抽不到**、且必须被 `A2b` 拦下」（`S2`，防假绿）；
 *   · `[F]` = **发现**（不参与退出码）：代码读但三处都没登记的键 · 文档提到但真源不认的键 ——
 *     探针的职责是**把事实钉死**，不是替文档判对错。
 *
 * 用法（零依赖，直接用 node 跑）：
 *   node memory.agent-mate.ai/probes/deploy-guide-audit/probe.mjs
 *   退出码：0 全部断言通过 · 10 前置不足（找不到仓库结构）· 30 断言失败
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../../..');           // 仓根
const PORTAL = path.join(REPO, 'memory.agent-mate.ai/admin_portal');
const SPECS = path.join(REPO, 'memory.agent-mate.ai/specs');
const DEPLOY = path.join(REPO, 'memory.agent-mate.ai/deploy');

const pass = [];
const fail = [];
const check = (id, ok, label, detail = '') => {
  (ok ? pass : fail).push(id);
  console.log(`[${id}] ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const finding = (label, detail) => console.log(`[F] 发现：${label} — ${detail}`);
const info = (msg) => console.log(`[i] ${msg}`);

if (!fs.existsSync(PORTAL) || !fs.existsSync(SPECS) || !fs.existsSync(DEPLOY)) {
  console.error('[10] 前置不足：找不到 admin_portal / specs / deploy 目录（请在仓内运行）');
  process.exit(10);
}

/** 递归收集文件（跳过 node_modules / .git / out / coverage）。 */
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return /^(node_modules|\.git|out|coverage|dist)$/.test(entry.name) ? [] : walk(full);
    }
    return [full];
  });

/** 键的形状：全大写 + 至少一个下划线（**排除 `AC10` 这类编号**；`<PLACEHOLDER>` 形态另行剔除）。 */
const KEYS = /(?<![A-Z0-9_<])([A-Z][A-Z0-9]*_[A-Z0-9_]{2,})(?![A-Z0-9_>])/g;
const keysIn = (text) => new Set([...text.matchAll(KEYS)].map((m) => m[1]));

/**
 * 「**真正会读**」的实现口径（2026-09-25 收窄；本仓现状：`config.ts` 是唯一入口 ——
 * 全文 `process.env.*` 0 处、`raw.*` 43 处、`raw = RawEnvSchema.safeParse(env).data`）。
 * 三种形态**逐行**匹配（不跨行、不吞字符串），这样注释里的键名不会被当成读取：
 *   ① `PORTAL_X:` —— zod schema 的对象键（`RawEnvSchema`）
 *   ② `raw.PORTAL_X` —— 解析后的引用
 *   ③ `process.env.PORTAL_X` —— 直读环境变量（当前 0 处，留作防回归）
 */
const READ_PATTERNS = [
  /^\s*(PORTAL_[A-Z0-9_]+)\s*:/g,
  /\braw\.(PORTAL_[A-Z0-9_]+)\b/g,
  /\bprocess\.env\.(PORTAL_[A-Z0-9_]+)\b/g,
];
const readKeysIn = (text) => {
  const out = { schema: new Set(), raw: new Set(), env: new Set() };
  const [RE_SCHEMA, RE_RAW, RE_ENV] = READ_PATTERNS;
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(RE_SCHEMA)) out.schema.add(m[1]);
    for (const m of line.matchAll(RE_RAW)) out.raw.add(m[1]);
    for (const m of line.matchAll(RE_ENV)) out.env.add(m[1]);
  }
  return out;
};

/**
 * `A2b` 的白名单：**源码里出现、但不是真读取、且允许存在**的令牌 —— 每条**必须带理由**。
 * 它同时把「靠改注释消红」这条路堵住：解释要留在这里，且条目必须**仍被引用**（否则报陈旧）。
 */
const UNEXPLAINED_OK = {
  PORTAL_CONTACT_EMAIL: '注释里的**将来键名**（`#4.2` 交付的「待配置化」登记：当前无配置键承载它，如需按部署改地址再加）',
};
/** `A2c` 的白名单：部署侧**故意**声明、但代码不读取的键（必须带理由；条目仍被声明才有效）。 */
const DEPLOY_ONLY_OK = {
  // 目前为空 —— 2026-09-26 已把唯一的「无读取方的键」（`PORTAL_ROOT`）从 compose 与
  // `deployment.md` §12.5.4 删除（理由：产品代码三种真读取形态皆不命中）。
};
const unexplainedOf = (tokens, reads, allow = UNEXPLAINED_OK) =>
  [...tokens].filter((key) => !reads.has(key) && !(key in allow)).sort();

// ---------------------------------------------------------------- 代码侧：门户真正会读的 PORTAL_* 键
// 两条通道：`portalKeys` = 真读取（判 `A2`）· `allTokens` = 源码里出现过的全部令牌（判 `A2b`）
const portalKeys = new Set();
const allTokens = new Set();
const schemaKeys = new Set();
const rawRefs = new Set();
const envRefs = new Set();
for (const file of walk(path.join(PORTAL, 'src'))) {
  if (!/\.ts$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const read = readKeysIn(text);
  for (const key of [...read.schema, ...read.raw, ...read.env]) portalKeys.add(key);
  for (const key of read.schema) schemaKeys.add(key);
  for (const key of read.raw) rawRefs.add(key);
  for (const key of read.env) envRefs.add(key);
  for (const key of keysIn(text)) if (key.startsWith('PORTAL_')) allTokens.add(key);
}

// ---------------------------------------------------------------- 部署侧：**全部** compose + *.env*.example
//
// **扫全部 compose，不硬编码文件名**（首版只扫 `docker-compose.prod.yml` ⇒ 新增的
// `portal.compose.yml` 被漏掉，`A2` 便只能靠指南文本「碰巧」转绿 —— 那不是它该有的判据）。
const composeFiles = fs
  .readdirSync(DEPLOY)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => path.join(DEPLOY, name));
const composeText = composeFiles
  .filter((file) => fs.existsSync(file))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');
/**
 * compose 里**定义或引用**的键都算「部署侧认得」—— **三种 YAML 形态都要抽**（漏一种就会把
 * 「真源里有」误报成「遗漏」；本探针首版正是只抽了 `KEY:` 形态，把 21 个 `PORTAL_*` 全误报成遗漏）：
 *   ① 映射形态 `KEY: value` ② 列表形态 `- KEY=value` ③ 插值引用 `${KEY}`
 */
const composeKeys = new Set([
  ...[...composeText.matchAll(/^\s*([A-Z][A-Z0-9_]{3,})\s*:/gm)].map((m) => m[1]),
  ...[...composeText.matchAll(/^\s*-\s*([A-Z][A-Z0-9_]{3,})\s*=/gm)].map((m) => m[1]),
  ...[...composeText.matchAll(/\$\{([A-Z][A-Z0-9_]{3,})/g)].map((m) => m[1]),
]);
const exampleFiles = fs
  .readdirSync(DEPLOY)
  .filter((name) => /\.env.*\.example$/.test(name))
  .map((name) => path.join(DEPLOY, name));
const exampleKeys = new Map(); // 文件 → 键集合
for (const file of exampleFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const keys = new Set(
    text
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .flatMap((line) => [...line.matchAll(/^\s*([A-Z][A-Z0-9_]{3,})\s*=/g)].map((m) => m[1])),
  );
  exampleKeys.set(path.basename(file), keys);
}
const deployKeys = new Set([...composeKeys, ...[...exampleKeys.values()].flatMap((s) => [...s])]);

/**
 * 取 compose 里**服务 `environment:` 块内**声明的键（按缩进切块）。
 *
 * **为什么要与 `composeKeys` 分开**：`composeKeys` 是按行抽「长得像键」的一切，会把 compose 自身的
 * **插值变量**也算进来（`image: ${PORTAL_IMAGE}` 里的 `PORTAL_IMAGE` 是 compose 用来**定位镜像**的，
 * 本来就不该被门户代码读取）⇒ 拿它判 `A2c` 会**假红**。`A2c` 只关心「**给容器的环境**」。
 */
function envBlockKeys(text) {
  const keys = new Set();
  let blockIndent = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    if (blockIndent === null) {
      if (/^environment:\s*$/.test(trimmed)) blockIndent = indent;
      continue;
    }
    if (trimmed === '' || trimmed.startsWith('#')) continue; // 空行 / 注释不改变块边界
    if (indent <= blockIndent) {
      blockIndent = null; // 回到同级 ⇒ 块已结束（本行不再视为块内容）
      continue;
    }
    const matched = /^([A-Z][A-Z0-9_]{3,})\s*:/.exec(trimmed);
    if (matched) keys.add(matched[1]);
  }
  return keys;
}

// ---------------------------------------------------------------- 文档侧：指南
const docFiles = [path.join(SPECS, 'deployment.md'), path.join(DEPLOY, 'README.md')].filter((f) =>
  fs.existsSync(f),
);
const docKeys = new Set();
let docText = '';
for (const file of docFiles) {
  const text = fs.readFileSync(file, 'utf8');
  docText += text;
  for (const key of keysIn(text)) docKeys.add(key);
}

info(`代码侧 PORTAL_* 键 ${portalKeys.size} 个 · 部署侧 ${deployKeys.size} 个 · 文档侧全大写键 ${docKeys.size} 个`);
info(
  `部署侧文件：compose=${composeKeys.size} 键（扫 ${composeFiles.map((f) => path.basename(f)).join(' + ')}）` +
    ` · ${[...exampleKeys.entries()].map(([f, s]) => `${f}=${s.size}`).join(' · ')}`,
);

check(
  'A1',
  portalKeys.size > 0 && deployKeys.size > 0 && docKeys.size > 0,
  '三侧都抽到了键（否则比对无意义）',
  `代码 ${portalKeys.size} · 部署 ${deployKeys.size} · 文档 ${docKeys.size}`,
);

// Q1：代码会读、但三处都没登记的键 ⇒ 读者照做会缺配置（门户 `4.3` 的启动自检会拒绝启动，属「响亮失败」）
const unregistered = [...portalKeys].filter((key) => !deployKeys.has(key) && !docKeys.has(key)).sort();
check(
  'A2',
  unregistered.length === 0,
  '**门户真正会读的每个 `PORTAL_*` 键，都至少在一处（compose / *.env.example / 指南）被登记**',
  unregistered.length === 0 ? '无遗漏' : `遗漏 ${unregistered.length} 个`,
);
for (const key of unregistered) finding('代码会读、但 compose 与 *.env.example 与指南**都没有**这个键', key);

// ---- `A2` 的两条派生断言（收窄口径之后的守门人）------------------------------------
// `A2a`：「读了却没声明」—— `raw.X` 必须都能在 `RawEnvSchema` 里找到。这是「配置契约缺一块」的
// 最早信号（`raw.X` 为 undefined 时往往只在下游出现怪行为，而不是启动期响亮失败）。
const undeclared = [...rawRefs].filter((key) => !schemaKeys.has(key)).sort();
check(
  'A2a',
  undeclared.length === 0,
  '`raw.X` 引用都能在 `RawEnvSchema` 里找到声明（读了却没声明 ⇒ 配置契约缺一块）',
  undeclared.length ? `缺声明：${undeclared.join(', ')}` : `${rawRefs.size} 个引用全部有声明`,
);
for (const key of undeclared) finding('代码用 `raw.X` 读了、但 `RawEnvSchema` 里没有这个键的声明', key);
const unusedSchema = [...schemaKeys].filter((key) => !rawRefs.has(key)).sort();
info(
  unusedSchema.length
    ? `schema 里声明但未见 raw. 引用的键 ${unusedSchema.length} 个（可选键有默认值分支，属正常）：${unusedSchema.join(', ')}`
    : 'schema 里的每个键都有 raw. 引用',
);

// `A2b`：「未解释令牌」—— 收窄口径会把「注释里的键名」挡在 `A2` 之外，于是**新的风险**是有人靠改
// 注释「消红」：因此要求源码里出现的每个 `PORTAL_*` 令牌**要么是真读取、要么在白名单里带理由**，
// 且白名单条目必须**仍被引用**（注释删了却忘删白名单 ⇒ 陈旧，同样报错）。
const unexplained = unexplainedOf(allTokens, portalKeys);
const stale = Object.keys(UNEXPLAINED_OK).filter((key) => !allTokens.has(key)).sort();
check(
  'A2b',
  unexplained.length === 0 && stale.length === 0,
  '源码里出现的每个 `PORTAL_*` 令牌**要么是真读取、要么在白名单里带理由**（防「靠改注释消红」）',
  [
    unexplained.length ? `未解释：${unexplained.join(', ')}` : `未解释 0 个（白名单 ${Object.keys(UNEXPLAINED_OK).length} 条）`,
    stale.length ? `陈旧白名单：${stale.join(', ')}` : '无陈旧白名单条目',
  ].join(' · '),
);
for (const key of unexplained)
  finding('源码里出现、但**既非真读取、也不在白名单**的 `PORTAL_*` 令牌（新写的注释键名？请在白名单里解释）', key);
for (const key of stale) finding('白名单里的条目**已不再被引用**（注释删了、白名单没删 ⇒ 陈旧）', key);

// `A2c`：「**部署侧声明的键 → 代码读取方**」—— `A2` 是**单向**的（只判「代码会读 → 必须被登记」），
// 反方向此前**没有任何判据** ⇒ 会留下「看起来能配、其实无作用」的键。实测依据：`PORTAL_ROOT` 曾在
// `portal.compose.yml` 与 `deployment.md` §12.5.4 各登记一处，而产品代码三种真读取形态皆不命中 ——
// 本门禁当时仍恒绿（方向缺口的登记见 `probes/portal-artifact-contract-probe/` 的 `B1`）。
// 口径：部署侧（**服务 `environment:` 块** + `*.env.example`）的每个 `PORTAL_*` 键，要么**真被代码
// 读取**，要么在 `DEPLOY_ONLY_OK` 里**带理由**；白名单条目必须**仍被部署侧声明**（声明删了却忘删
// 白名单 ⇒ 陈旧，同样报错）—— 与 `A2b` 同体例。
const deployOnlyOf = (declared, reads, allow = DEPLOY_ONLY_OK) =>
  [...declared]
    .filter((key) => key.startsWith('PORTAL_') && !reads.has(key) && !(key in allow))
    .sort();
const deployEnvKeys = new Set([
  ...composeFiles.flatMap((file) => [...envBlockKeys(fs.readFileSync(file, 'utf8'))]),
  ...[...exampleKeys.values()].flatMap((set) => [...set]),
]);
const deployOnly = deployOnlyOf(deployEnvKeys, portalKeys);
const staleDeployOnly = Object.keys(DEPLOY_ONLY_OK)
  .filter((key) => !deployEnvKeys.has(key))
  .sort();
check(
  'A2c',
  deployOnly.length === 0 && staleDeployOnly.length === 0,
  '**部署侧声明的每个 `PORTAL_*` 键，要么被代码真读取、要么在白名单里带理由**（防「看起来能配、其实无作用」）',
  [
    deployOnly.length
      ? `无读取方且无理由：${deployOnly.join(', ')}`
      : `无读取方的键 0 个（部署侧声明 ${deployEnvKeys.size} 个 · 白名单 ${Object.keys(DEPLOY_ONLY_OK).length} 条）`,
    staleDeployOnly.length ? `陈旧白名单：${staleDeployOnly.join(', ')}` : '无陈旧白名单条目',
  ].join(' · '),
);
for (const key of deployOnly)
  finding('部署侧（compose `environment:` / `*.env.example`）声明了、但**代码从不读取**，且白名单里没有理由', key);
for (const key of staleDeployOnly)
  finding('白名单里的键**已不在部署侧声明**（声明删了、白名单没删 ⇒ 陈旧）', key);

// ---- 判据自检：注入样本，验两个失效方向（正对照防假红 · 反对照防假绿）----------------
const SAMPLE = [
  '  PORTAL_FOO_BAR: z.string().optional(),', // ① schema 键
  'const x = raw.PORTAL_FOO_BAR;', // ② raw 引用
  'process.env.PORTAL_BAZ_QUX;', // ③ process.env 直读
  '* 如需可再加 `PORTAL_COMMENT_ONLY`（注释里的将来键名）', // 只出现在注释里
].join('\n');
const sampleRead = readKeysIn(SAMPLE);
check(
  'S1',
  sampleRead.schema.has('PORTAL_FOO_BAR') &&
    sampleRead.raw.has('PORTAL_FOO_BAR') &&
    sampleRead.env.has('PORTAL_BAZ_QUX'),
  '正对照：三种真读取形态注入后**必须**被抽到（否则会漏真读取 ⇒ 假红）',
  `schema=[${[...sampleRead.schema].join(', ')}] · raw=[${[...sampleRead.raw].join(', ')}] · env=[${[...sampleRead.env].join(', ')}]`,
);
const sampleTokens = new Set([...keysIn(SAMPLE)].filter((key) => key.startsWith('PORTAL_')));
const sampleReads = new Set([...sampleRead.schema, ...sampleRead.raw, ...sampleRead.env]);
const sampleCaught = unexplainedOf(sampleTokens, sampleReads, {});
check(
  'S2',
  !sampleReads.has('PORTAL_COMMENT_ONLY') && sampleCaught.includes('PORTAL_COMMENT_ONLY'),
  '反对照：注释里的键名**抽不到**，且必须被 `A2b` 拦下（否则会误抽注释 ⇒ 假绿 / 存在消红通道）',
  `注释令牌未进读取=${!sampleReads.has('PORTAL_COMMENT_ONLY')} · A2b 拦下注释令牌=${sampleCaught.includes('PORTAL_COMMENT_ONLY')}`,
);
// `A2c` 的判据自检：合成一个「部署侧声明、代码不读、白名单无理由」的键 ⇒ **必须被命中**（防恒绿）
const sampleDeployOnly = deployOnlyOf(new Set([...deployEnvKeys, 'PORTAL_SELFTEST_KEY']), portalKeys, {});
check(
  'S4',
  sampleDeployOnly.includes('PORTAL_SELFTEST_KEY') && !deployOnly.includes('PORTAL_SELFTEST_KEY'),
  '`A2c` 判据自检：注入「部署侧声明、代码不读、无理由」的合成键 ⇒ **必须被命中**（防恒绿）',
  `合成键命中=${sampleDeployOnly.includes('PORTAL_SELFTEST_KEY')} · 真实集里不含它=${!deployOnly.includes('PORTAL_SELFTEST_KEY')}`,
);
// `envBlockKeys` 的判据自检：**服务 `environment:` 块内**的键要抽到，compose **自身的插值变量**不能抽到
const sampleEnvText = [
  'services:',
  '  portal:',
  '    image: ${PORTAL_IMAGE:?set me}',
  '    environment:',
  '      PORTAL_ENV: production',
  '      # PORTAL_COMMENTED: x',
  '      PORTAL_PORT: "8080"',
  '    volumes:',
  '      - ./a:/b',
].join('\n');
const sampleEnvKeys = envBlockKeys(sampleEnvText);
check(
  'S5',
  sampleEnvKeys.has('PORTAL_ENV') &&
    sampleEnvKeys.has('PORTAL_PORT') &&
    !sampleEnvKeys.has('PORTAL_IMAGE') &&
    !sampleEnvKeys.has('PORTAL_COMMENTED'),
  '`A2c` 抽键判据自检：`environment:` 块内命中、**compose 自身插值变量**（`${PORTAL_IMAGE}`）与注释键名**不**命中',
  `命中=[${[...sampleEnvKeys].join(', ')}]（期望恰为 PORTAL_ENV / PORTAL_PORT）`,
);

// Q4：文档提到、但真源（代码 / 部署）都不认的键 ⇒ 陈旧或属上游 config（需人工判，故只作发现）
const docOnly = [...docKeys]
  .filter((key) => !portalKeys.has(key) && !deployKeys.has(key))
  .sort();
if (docOnly.length > 0) {
  finding(
    `指南提到但**代码与部署真源都没有**的键 ${docOnly.length} 个（多半是上游 config.toml 的键，需人工判有无陈旧）`,
    docOnly.join(', '),
  );
} else {
  info('指南提到的键全部能在真源里找到出处');
}

// Q2：指南引用的仓库路径是否存在（**相对该文档所在目录**解析；排除 `<占位符>`）
const referenced = []; // { base, rel }
for (const file of docFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/]\((\.\.?\/[^)\s]+?)\)/g)) {
    const rel = match[1];
    if (rel.includes('<') || !/\.(sh|yml|yaml|toml|tmpl|example|json|md)$/.test(rel)) continue;
    referenced.push({ base: path.dirname(file), rel });
  }
}
const missingPaths = referenced
  .filter(({ base, rel }) => !fs.existsSync(path.resolve(base, rel)))
  .map(({ rel }) => rel);
check(
  'A3',
  missingPaths.length === 0,
  `指南里引用的仓库路径都存在（共 ${referenced.length} 个）`,
  missingPaths.length === 0 ? '全部可达' : `缺失：${missingPaths.join(', ')}`,
);

// Q3：`deployment.md` §5.4 自称「与 ../deploy/.env.prod.example 逐键一致」—— 这条承诺可机械判定
const prodExample = exampleKeys.get('.env.prod.example');
if (!prodExample) {
  check('A4', false, '找到 `deploy/.env.prod.example`（§5.4 的「逐键一致」承诺的比对对象）', '文件不存在');
} else {
  const section = docText.split('### 5.4')[1]?.split('\n###')[0] ?? '';
  const sectionKeys = new Set(
    [...section.matchAll(/^\s*([A-Z][A-Z0-9_]{3,})\s*=/gm)].map((m) => m[1]),
  );
  const same =
    sectionKeys.size === prodExample.size && [...sectionKeys].every((key) => prodExample.has(key));
  check(
    'A4',
    same,
    '`deployment.md` §5.4 的代码块与 `../deploy/.env.prod.example` **逐键一致**（文档自己承诺过）',
    `§5.4=[${[...sectionKeys].sort().join(', ')}] · 真源=[${[...prodExample].sort().join(', ')}]`,
  );
}

// Q5：compose 的**结构底线** —— 本机**没有 compose 插件、也没有 YAML 解析器**（实测：`docker compose`
// 报 `unknown shorthand flag: 'f'`；node_modules 里无 `yaml` / `js-yaml`）⇒ 做不了真解析。
// **真正的解析在服务器侧**由 `docker compose config` 兜底（deployment.md §12.5.5 第 1 步）；
// 这里只把「最常见的写坏方式」钉住：制表符缩进（YAML 不允许）· 缺顶层 `services:` · 空 `image:`。
const composeProblems = [];
for (const file of composeFiles) {
  const name = path.basename(file);
  const text = fs.readFileSync(file, 'utf8');
  if (/^\t/m.test(text)) composeProblems.push(`${name}: 用了制表符缩进（YAML 不允许）`);
  if (!/^services:/m.test(text)) composeProblems.push(`${name}: 缺顶层 services:`);
  if (!/^name:/m.test(text)) composeProblems.push(`${name}: 缺顶层 name:`);
  for (const match of text.matchAll(/^\s*image:\s*(.*)$/gm)) {
    if (match[1].trim() === '' || match[1].trim() === '""') {
      composeProblems.push(`${name}: 有空 image:`);
    }
  }
}
check(
  'A5',
  composeProblems.length === 0,
  `deploy 下的 compose 结构底线（${composeFiles.map((f) => path.basename(f)).join(' + ')}：无制表符缩进 · 有顶层 name/services · image 非空）`,
  composeProblems.join(' | ') || '全部通过',
);

console.log(`\n  通过 ${pass.length} 项 · 失败 ${fail.length} 项`);
process.exitCode = fail.length === 0 ? 0 : 30;
