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
 *   · **代码侧**：`admin_portal/src/**` 里出现的 `PORTAL_*` 键 —— 门户**真正会读**的那一套；
 *   · **部署侧**：`deploy/docker-compose.prod.yml` + `deploy/*.env*.example` 里定义的键 —— 运维**真正会填**的那一套；
 *   · **文档侧**：`specs/deployment.md` + `deploy/README.md` 里出现的全大写键 —— 指南**要求读者知道**的那一套。
 *
 * ## 判据口径
 *
 *   · `[A*]` = **断言**（决定退出码）：三侧都抽到非空 · 指南引用的路径都存在 · §5.4 的「逐键一致」成立；
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

// ---------------------------------------------------------------- 代码侧：门户真正会读的 PORTAL_* 键
const portalKeys = new Set();
for (const file of walk(path.join(PORTAL, 'src'))) {
  if (!/\.ts$/.test(file)) continue;
  for (const key of keysIn(fs.readFileSync(file, 'utf8'))) {
    if (key.startsWith('PORTAL_')) portalKeys.add(key);
  }
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
