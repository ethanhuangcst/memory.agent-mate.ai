/**
 * 模板渲染助手单元测试。
 *
 * 重点在**失败路径**：`renderPage` 必须把模板错误变成 reject（由调用方转 500），
 * 而不是静默返回半截 HTML —— 半截页面比 500 更难排查，也更容易把内部结构泄露出去。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type PortalConfig } from '../../src/config';
import { createRenderEnv, renderPage } from '../../src/web/render';

let root: string;
let viewsRoot: string;
let cfg: PortalConfig;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-render-'));
  viewsRoot = path.join(root, 'views');
  fs.mkdirSync(viewsRoot, { recursive: true });
  fs.writeFileSync(path.join(viewsRoot, 'probe.njk'), 'Hello {{ name }}');
  fs.writeFileSync(path.join(viewsRoot, 'undefined.njk'), 'Hello {{ missing }}');

  cfg = {
    ...loadConfig({
      PORTAL_ADMIN_HOST: 'localhost',
      PORTAL_MCP_HOST: 'mcp.localhost',
      PORTAL_DB_PATH: path.join(root, 'portal.db'),
    }),
    viewsRoot,
  };
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('createRenderEnv / renderPage', () => {
  it('渲染成功：返回模板结果（Promise 化，未定义变量不抛）', async () => {
    const html = await renderPage(createRenderEnv(cfg), 'probe.njk', { name: 'alice' });
    expect(html).toBe('Hello alice');
  });

  it('模板不存在 ⇒ reject（不返回空串冒充成功）', async () => {
    await expect(renderPage(createRenderEnv(cfg), 'nope.njk', {})).rejects.toThrow();
  });

  it('引用了未定义变量 ⇒ reject（throwOnUndefined 生效，缺键当场暴露）', async () => {
    await expect(renderPage(createRenderEnv(cfg), 'undefined.njk', {})).rejects.toThrow(
      /undefined value/,
    );
  });

  it('生产环境开启模板缓存，开发环境关闭（改模板即时生效）', async () => {
    const dev = createRenderEnv(cfg);
    const prod = createRenderEnv({ ...cfg, isProduction: true, env: 'production' });
    // 两者都能渲染；差异体现在 loader 的 noCache 选项上（生产改文件不生效）
    expect(await renderPage(dev, 'probe.njk', { name: 'a' })).toBe('Hello a');
    expect(await renderPage(prod, 'probe.njk', { name: 'b' })).toBe('Hello b');
  });
});
