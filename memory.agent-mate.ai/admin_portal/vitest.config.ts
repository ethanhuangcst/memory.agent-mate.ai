import { defineConfig } from 'vitest/config';

/**
 * 离线测试配置：单元与集成测试零网络依赖、可重复执行。
 * 在线端到端（隧道 + 真 Cloudflare Access）不走本配置，见 scripts/portal-e2e.sh。
 *
 * 覆盖率口径（`npm run test:coverage`，入口 `make portal-coverage`）：
 *  - provider = v8，与 vitest 同版（@vitest/coverage-v8 5.0.1，见 package.json 钉死）。
 *  - `include` 覆盖全部业务源码（src/**），**默认不排除任何业务逻辑**。
 *  - 阈值低于即**失败**（可机器判定）：取实测基线的向下取整并留约 3 个百分点的余量，
 *    使「真实回退」会被挡住，而无关紧要的抖动不会误报。
 *
 * 首测基线（2026-09-22，补测前）→ 现值：
 *   语句 79.30 → 94.87 · 分支 72.74 → 88.25 · 函数 88.02 → 98.77 · 行 80.05 → 96.39
 *
 * 显式豁免（**非静默排除**，逐条理由）：
 *  - `src/server.ts` 的 `main()` 与 `src/web/db/migrate.ts` 的 CLI 引导块：进程入口胶水，
 *    在测试进程内执行会绑定端口 / 注册信号 / 写 process 流并置退出码；其各段逻辑
 *    （loadConfig · runSelfCheck · buildServer · migrate · 仓储）均已被单测或集成测试覆盖。
 *    豁免以源码内 `/* v8 ignore start|stop *​/` 标注（见两处注释），不是配置层一刀切。
 *
 * 已知未覆盖且判定为「防御性 / 不可达」的分支（保留不测，理由随行）：
 *  - `error instanceof Error ? … : String(error)` 的 else 侧（自检、脱敏、迁移）：
 *    Node 的 fs/jose 只抛 Error 实例，else 侧为防范非 Error 抛出而保留；
 *  - `services/keys.ts` 的 `catch`（目录创建失败 ⇒ `directory-failed`）：需要构造
 *    「用户目录被文件占位」等损坏态，已有 `ensureUserDirectory` 的单测覆盖其判断本身；
 *  - `t()` 的 `?? reference[key]` 右支：四语言词表键集合一致（启动期 fail-loud 强制），
 *    该支仅在词表不一致时才可达 ⇒ 与 ③ 互斥。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    reporters: ['default'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: [],
      thresholds: {
        statements: 92,
        branches: 85,
        functions: 96,
        lines: 93,
      },
    },
  },
});
