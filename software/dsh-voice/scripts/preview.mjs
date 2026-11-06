import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConfigStore } from '../host/config.js';
import { createHandler } from '../host/routes.js';
import { TaskService } from '../core/tasks.js';
import { ReplyTracker } from '../core/replies.js';
import { MediaLibrary, MAX_MEDIA_BYTES } from '../core/media-library.js';
import { DisplayService, MAX_FRAME_BYTES } from '../extensions/display.js';
import { SoundLibrary, MAX_SOUND_BYTES } from '../core/sounds.js';
import { BackgroundScreen } from '../core/screen-background.js';

export function sampleWav() {
  const length = 8000;
  const bytes = Buffer.alloc(44 + length * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(length * 2, 40);
  for (let n = 0; n < length; n++) bytes.writeInt16LE(Math.round(Math.sin(n * Math.PI * 880 / 16000) * 1000), 44 + n * 2);
  return bytes;
}
export async function createPreview({ port = 0, dataDir, synth, getSession, replies = new ReplyTracker(), extraAssets = new Map(), mediaOptions } = {}) {
  const directory = dataDir || mkdtempSync(join(tmpdir(), 'lease-voice-preview-'));
  const store = createConfigStore(directory);
  const sounds = new SoundLibrary(directory); await sounds.ready;
  const tasks = new TaskService(store, synth || (async () => ({ bytes: sampleWav(), mime: 'audio/wav' })), { sounds });
  const media = new MediaLibrary(directory, mediaOptions);
  const display = new DisplayService(store);
  const background = new BackgroundScreen(media, display);
  await media.ready;
  const handler = createHandler({ store, tasks, replies, media, display, sounds, background, getSession: getSession || (() => undefined), preview: true });
  const server = createServer(async (req, res) => {
    if (extraAssets.has(req.url)) {
      const asset = extraAssets.get(req.url); res.writeHead(200, { 'Content-Type': asset.type }); res.end(asset.body); return;
    }
    if (req.url === '/') { res.writeHead(302, { Location: '/api/lease-voice/ui' }); res.end(); return; }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > (req.url === '/api/lease-voice/media-import' ? MAX_MEDIA_BYTES : req.url === '/api/lease-voice/screen-frame' ? MAX_FRAME_BYTES : req.url === '/api/lease-voice/sound-import' ? MAX_SOUND_BYTES : 65536)) throw new Error('body too large'); chunks.push(chunk); }
      const request = new Request(`http://127.0.0.1:${server.address().port}${req.url}`, { method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
      const result = await handler(request);
      res.writeHead(result.status, Object.fromEntries(result.headers));
      res.end(Buffer.from(await result.arrayBuffer()));
    } catch { res.writeHead(400); res.end('preview request failed'); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, store, tasks, replies, media, display, sounds, background, directory, url: `http://127.0.0.1:${server.address().port}`, close: async () => { tasks.dispose(); await background.dispose(); await display.dispose(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const preview = await createPreview({ port: Number(process.env.PORT || 4318), dataDir: process.env.LEASE_VOICE_PREVIEW_DATA_DIR });
  console.log(`隔离预览（模拟音频，不连接真实 DSH）：${preview.url}/api/lease-voice/ui`);
  console.log(`临时配置：${preview.directory}；请勿在预览中填写真实密钥。`);
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    if (closing) return; closing = true;
    void preview.close().then(() => process.exit(0));
  });
}
