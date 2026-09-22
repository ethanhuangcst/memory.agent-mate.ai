/**
 * 模板渲染助手 —— Nunjucks 环境构造与「模板 → HTML」的 Promise 包装。
 *
 * 约定（web-design.md §12.4）：模板结构逐字对齐 `specs/web-portal/mockups/*.html`；
 * 生产开启模板缓存，开发关闭（改模板即时生效）。
 */

import nunjucks from 'nunjucks';
import type { PortalConfig } from '../config';

export type RenderEnv = nunjucks.Environment;

export function createRenderEnv(cfg: PortalConfig): RenderEnv {
  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader(cfg.viewsRoot, { noCache: !cfg.isProduction }),
    {
      autoescape: true,
      throwOnUndefined: true,
      trimBlocks: true,
      lstripBlocks: true,
    },
  );
  return env;
}

/** 渲染模板；失败即 reject（由调用方转成 500，不回传内部路径）。 */
export function renderPage(env: RenderEnv, template: string, context: object): Promise<string> {
  return new Promise((resolve, reject) => {
    env.render(template, context, (error, result) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      resolve(result ?? '');
    });
  });
}
