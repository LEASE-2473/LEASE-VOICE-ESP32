// Local, offline browser decoding. Original MP3s are read-only; no TTS calls.
import { readFileSync, readdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createPreview } from '../software/dsh-voice/scripts/preview.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = realpathSync(join(root, 'assets'));
const directory = process.env.LEASE_VOICE_IMPORT_DATA || join(root, 'software/dsh-voice/data/screen-preview');
const files = readdirSync(source).filter(name => /\.(mp3|wav)$/i.test(name)).sort();
if (!files.length) throw new Error('No MP3/WAV files in assets');
const assets = new Map(), originals = [];
for (const [index, name] of files.entries()) {
  const path = realpathSync(join(source, name)), rel = relative(source, path);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../')) throw new Error('Source escapes assets directory');
  const bytes = readFileSync(path);
  if (bytes.length > 12 * 1024 * 1024) throw new Error('Source audio exceeds 12MiB');
  originals.push({ name, path, sourceBytes: bytes.length, sourceSha256: createHash('sha256').update(bytes).digest('hex') });
  assets.set(`/source-${index}`, { type: /\.mp3$/i.test(name) ? 'audio/mpeg' : 'audio/wav', body: bytes });
}
const require = createRequire(new URL('../software/dsh-voice/package.json', import.meta.url));
const { chromium } = require('playwright');
const preview = await createPreview({ dataDir: directory, extraAssets: assets });
let browser;
const report = [];
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const page = await browser.newPage();
  await page.goto(`${preview.url}/api/lease-voice/screen`);
  for (const [index, item] of originals.entries()) {
    const imported = await page.evaluate(async ({ index, name }) => {
      const { normalizeAudio, importSound } = await import('/api/lease-voice/audio-tools.js');
      const response = await fetch(`/source-${index}`);
      return importSound(name, await normalizeAudio([await response.blob()]));
    }, { index, name: item.name });
    const record = { source: `assets/${item.name}`, sourceBytes: item.sourceBytes, sourceSha256: item.sourceSha256, ...imported.item };
    if (createHash('sha256').update(readFileSync(item.path)).digest('hex') !== item.sourceSha256) throw new Error('Source changed during import');
    report.push(record);
    console.log(JSON.stringify({ name: imported.item.name, seconds: imported.item.seconds, bytes: imported.item.bytes, peak: imported.item.peak, duplicate: !!imported.duplicate }));
  }
  preview.store.save({ completion: { sound: 'random', clipIds: report.map(item => item.id) } });
  writeFileSync(join(source, 'completion-sounds.manifest.json'), `${JSON.stringify({ version: 1, source: '用户提供，保留原始文件，不随插件发布', format: 'WAV PCM16LE 24000Hz mono', items: report }, null, 2)}\n`);
  console.log(JSON.stringify({ imported: report.length, dataDirectory: directory, automaticEnabled: preview.store.get().completion.enabled, mode: preview.store.get().completion.sound }));
} finally { await browser?.close(); await preview.close(); }
