import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({
  entryPoints: [fileURLToPath(new URL('../client/entry.js', import.meta.url))],
  outfile: fileURLToPath(new URL('../client/index.js', import.meta.url)),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  legalComments: 'none',
});
console.log('客户端已构建：播放器随 DSH 客户端加载，不再从 /api 动态导入。');
