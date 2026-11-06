import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const files = [];
function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (['node_modules', 'data', 'artifacts'].includes(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) walk(child); else if (/\.(m?js)$/.test(entry.name)) files.push(child);
  }
}
walk(root);
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status) throw new Error(result.stderr);
}
const manifest = JSON.parse(readFileSync(join(root, 'package.json')));
if (manifest.name !== 'dsh-lease-voice' || !manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings')) throw new Error('DSH 客户端声明缺失');
console.log(`通过：${files.length} 个 JS/MJS 语法与插件清单检查`);
