/**
 * 「真上游」端到端探针的执行体（被 `scripts/portal-mcp-probe.sh` 调用）。
 *
 * 与 `tests/integration/mcp-bridge.test.ts` 的分工：
 *  - 集成测试用**假上游**（`fake-upstream.mjs`）⇒ 完全离线、可重复，验的是**桥**；
 *  - 本执行体用**真上游**（容器里的 ai-memory 0.10.0，经 `docker exec` 借壳）⇒ 验的是
 *    「真二进制 + 真库落点 + 真召回」这条链路（`MS1 AC-M1.1` / `AC-M1.3` / `MS3 AC-M3.1` 的真版）。
 *
 * 所需环境（由主脚本注入）：`PROBE_PORTAL_ROOT` / `PROBE_PORTAL_DB` / `PROBE_PORTAL_PORT` /
 * `PROBE_HANDLE` / `PROBE_CONTAINER` / `PROBE_USERS_ROOT`。
 *
 * **实现注意（踩过的坑）**：全程**不使用 `process.exit()`**，只设 `process.exitCode`。
 * stdout 是管道时 Node 采用异步刷盘，强制退出会把最后的输出整段丢掉 ——
 * 表现为「脚本退出码 0，但日志 0 字节」，极难定位。（主脚本用 `tee` 读它的输出。）
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const root = process.env.PROBE_PORTAL_ROOT;
const dbPath = process.env.PROBE_PORTAL_DB;
const port = Number(process.env.PROBE_PORTAL_PORT ?? '8797');
const handle = process.env.PROBE_HANDLE ?? 'probe31';
const container = process.env.PROBE_CONTAINER ?? 'ai-memory-mcp';

const pass: string[] = [];
const fail: string[] = [];
const check = (ok: boolean, label: string, detail = ''): void => {
  (ok ? pass : fail).push(label);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

async function main(): Promise<number> {
  if (!root || !dbPath) {
    console.error('probe-runner: 缺少 PROBE_PORTAL_ROOT / PROBE_PORTAL_DB');
    return 10;
  }

  const mod = async <T>(rel: string): Promise<T> =>
    (await import(pathToFileURL(path.join(root, rel)).href)) as T;

  const { createUser } = await mod<typeof import('../../src/web/services/users')>(
    'src/web/services/users.ts',
  );
  const { issueKey } = await mod<typeof import('../../src/web/services/keys')>(
    'src/web/services/keys.ts',
  );

  // ---- 1. 建房户 + 签发令牌（直连门户库，不经管理面 ⇒ 无需 CF Access 身份）----
  const db = new Database(dbPath);
  const deps = {
    db,
    usersRoot: process.env.PROBE_USERS_ROOT ?? '/tmp/probe-users',
    actor: 'probe@local',
  };
  const created = createUser(deps, { handle });
  if (!created.ok) {
    console.error(`  建房户失败：${JSON.stringify(created)}`);
    db.close();
    return 10;
  }
  const issued = issueKey(deps, { handle });
  if (!issued.ok) {
    console.error(`  签发令牌失败：${JSON.stringify(issued)}`);
    db.close();
    return 10;
  }
  console.log(`  已建房户 ${handle} 并签发令牌（前缀 ${issued.key.key_prefix}）`);

  // ---- 2. 经 HTTP 建会话（真实 MCP 客户端）----
  const client = new Client({ name: 'portal-mcp-probe', version: '0.1.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${issued.plaintext}` } },
  });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);

  // ---- 3. 断言：工具数 / 写入 / 召回 ----
  const tools = await client.listTools();
  check(tools.tools.length === 8, 'core 档工具数为 8', `实得 ${tools.tools.length}`);

  const marker = `PROBE-MARKER-${Date.now()}`;
  const stored = await client.callTool({
    name: 'memory_store',
    arguments: { title: `真上游探针 ${marker}`, content: `${marker} 经门户 /mcp 写入真上游` },
  });
  check(!stored.isError, 'memory_store 成功', JSON.stringify(stored.content).slice(0, 90));

  const recalled = await client.callTool({ name: 'memory_recall', arguments: { context: marker } });
  const recalledText = JSON.stringify(recalled.content ?? '');
  check(recalledText.includes('count:1'), 'memory_recall 命中刚写入的记忆', recalledText.slice(0, 90));

  // ---- 4. 断言：库落点在容器内的该用户目录 ----
  const userDb = `/data/users/${handle}/ai-memory.db`;
  let landed = false;
  try {
    execFileSync('docker', ['exec', container, 'sh', '-c', `test -f ${userDb}`], {
      stdio: 'ignore',
    });
    landed = true;
  } catch {
    landed = false;
  }
  check(landed, '库文件落在该用户目录', userDb);

  // 注：**不**断言「共享主库不存在」—— 常驻 serve 进程本来就用 `/data/ai-memory.db`，它恒存在。
  // 「写入未落主库」这条在离线集成测试里用假上游验过。

  // ---- 5. 收尾：显式终止会话（服务端据此回收子进程）----
  await transport.terminateSession();
  await client.close();
  db.close();

  console.log(`\n  通过 ${pass.length} 项 · 失败 ${fail.length} 项`);
  return fail.length === 0 ? 0 : 30;
}

// 设 exitCode 而非 process.exit()：让 Node 把 stdout 刷完再退出（见文件头说明）。
process.exitCode = await main();
