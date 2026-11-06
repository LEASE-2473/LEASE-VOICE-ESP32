import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MediaLibrary } from '../core/media-library.js';
import { createPreview } from '../scripts/preview.mjs';
import { chimeAudio } from '../core/chime.js';
import { TaskService } from '../core/tasks.js';
import { createConfigStore } from '../host/config.js';

export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGN8AAAAASUVORK5CYII=', 'base64');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'lease-media-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'dsh'), data = join(root, 'data');
  await mkdir(join(home, 'meme-packs', 'test'), { recursive: true });
  await writeFile(join(home, 'meme-packs', 'test', '表情.png'), png);
  const library = new MediaLibrary(data, { home }); await library.ready;
  return { root, home, data, library };
}

test('可选素材来源：自动发现 meme-packs、只读扫描和路径不外泄；缺失 pet 不影响使用', async t => {
  const { library, home } = await fixture(t);
  const result = library.view();
  assert.equal(result.items.length, 1); assert.equal(result.items[0].source, 'meme');
  assert.equal(result.items[0].name, '表情.png');
  assert.equal(JSON.stringify(result.items).includes(home), false);
  assert.equal(result.output.deviceSupported, true); assert.equal(result.output.requiresFirmware, 'M3');
  await assert.rejects(library.remove(result.items[0].id), /只.*本插件/);
  assert.deepEqual(await readFile(join(home, 'meme-packs/test/表情.png')), png);
});

test('导入、列表重排和随机设置持久化，删除只影响本地库并同步移出列表', async t => {
  const { library, data, home } = await fixture(t);
  await Promise.all([library.import('我的表情.png', png), library.import('第二张.png', png)]);
  const view = library.view(); assert.equal(view.items.length, 3);
  const ids = view.items.filter(x => x.source === 'local').map(x => x.id);
  await library.update({ playlist: [ids[1], ids[0]], playback: { order: 'random', seconds: 2, width: 160, height: 128, zoom: 1.5 } });
  const again = new MediaLibrary(data, { home }); await again.ready;
  assert.deepEqual(again.view().playlist, [ids[1], ids[0]]); assert.equal(again.view().playback.width, 160);
  assert.equal(again.view().playback.zoom, 1.5);
  await assert.rejects(library.update({ playback: { zoom: 0 } }), /缩放/);
  await again.remove(ids[1]); assert.deepEqual(again.view().playlist, [ids[0]]);
  assert.equal(again.view().items.length, 2);
});

test('素材输入拒绝伪装 HTML/SVG、路径穿越、错误规格和失效 ID；符号链接不越出素材目录', async t => {
  const { library, root, home } = await fixture(t);
  await assert.rejects(library.import('fake.png', Buffer.from('<html>bad</html>')), /格式/);
  await assert.rejects(library.import('x.svg', Buffer.from('<svg/>')), /格式/);
  await assert.rejects(library.import('../x.png', png), /文件名/);
  await assert.rejects(library.update({ roots: { pet: '../private' } }), /绝对路径/);
  await assert.rejects(library.update({ playlist: ['not-found'] }), /失效/);
  await assert.rejects(library.update({ playback: { seconds: 0 } }), /设置/);
  await assert.rejects(library.update({ playback: { width: 9999 } }), /设置/);
  const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'secret.png'), png);
  await symlink(outside, join(home, 'meme-packs', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await library.change(() => library.scan());
  assert.equal(library.view().items.some(x => x.name === 'secret.png'), false);
  const id = library.view().items[0].id;
  assert.equal((await library.response('../private')).status, 404);
  assert.equal((await library.response(id, 'bytes=0-3')).status, 206);
  assert.equal((await library.response(id, 'bytes=99999-')).status, 416);
  assert.equal((await library.response(id, 'bytes=-0')).status, 416);
  await library.update({ roots: { pet: join(root, 'missing') } });
  assert.match(library.view().warnings.join(), /目录无法读取/);
});

test('真实 HTTP 素材上传、字节范围播放和独立配置，不接受客户端任意文件路径', async t => {
  const { data, home } = await fixture(t);
  const preview = await createPreview({ dataDir: data, mediaOptions: { home } });
  t.after(() => preview.close());
  const base = `${preview.url}/api/lease-voice`;
  const imported = await fetch(`${base}/media-import`, { method: 'POST', headers: { 'X-Lease-Filename': encodeURIComponent('上传.png') }, body: png });
  assert.equal(imported.status, 201);
  const view = await imported.json(); const item = view.items.find(x => x.source === 'local');
  const range = await fetch(`${base}/media-file?id=${item.id}`, { headers: { Range: 'bytes=0-7' } });
  assert.equal(range.status, 206); assert.equal(range.headers.get('Content-Type'), 'image/png');
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), png.subarray(0, 8));
  assert.equal((await fetch(`${base}/media-file?id=${encodeURIComponent('../config.json')}`)).status, 400);
  const page = await fetch(`${base}/screen`); assert.equal(page.status, 200);
  assert.match(await page.text(), /实际效果以现场屏幕为准/);
  assert.equal((await fetch(`${base}/config`)).status, 200);
});

test('叮声本地生成、淡入淡出和浏览器 WAV/设备 PCM 格式一致，不需要 TTS 凭据', async t => {
  const wav = chimeAudio('browser', 35), pcm = chimeAudio('esp32', 35);
  assert.equal(wav.bytes.toString('ascii', 0, 4), 'RIFF');
  assert.deepEqual(wav.bytes.subarray(44), pcm.bytes);
  assert.equal(pcm.sampleRate, 24000); assert.equal(pcm.format, 'pcm_s16le'); assert.equal(pcm.bytes.readInt16LE(0), 0);
  assert.ok(chimeAudio('esp32', 0).bytes.every(x => x === 0));
  const { data } = await fixture(t), store = createConfigStore(data);
  store.save({ completion: { enabled: true } });
  let calls = 0;
  const tasks = new TaskService(store, () => { calls++; throw new Error('不得调用'); }); t.after(() => tasks.dispose());
  tasks.lease('session', 'window1');
  const input = { chime: true, autoKey: 'chime:event1', clientId: 'window1', sessionId: 'session' };
  const first = tasks.start(input); assert.equal(first.state, 'ready'); assert.equal(calls, 0);
  assert.equal(tasks.start(input).duplicate, true);
  assert.throws(() => tasks.start({ ...input, clientId: 'window2' }), /资格/);
  assert.equal(createConfigStore(data).get().completion.enabled, true);
  store.save({ completion: { enabled: false } });
  assert.throws(() => tasks.start({ ...input, autoKey: 'chime:event2' }), /资格/);
  assert.throws(() => store.save({ completion: { volume: 999 } }), /音量/);
});

test('完成提示走现有设备 PCM 传输，正常回复后排队可超过 30 秒并按消息去重', async t => {
  const { data, home } = await fixture(t);
  const preview = await createPreview({ dataDir: data, mediaOptions: { home } }); t.after(() => preview.close());
  preview.store.save({ completion: { enabled: true, target: 'esp32' }, device: { endpoint: 'http://127.0.0.1:1' } });
  const played = [];
  preview.tasks.playDevice = async (device, audio) => { played.push(audio); };
  preview.tasks.lease('main', 'window');
  preview.replies.events.push({ sessionId: 'main', messageId: 'done', at: Date.now() - 31000 });
  // 单独构造 handler，避免给预览宿主写入任意真实会话。
  const { createHandler } = await import('../host/routes.js');
  const handler = createHandler({ store: preview.store, tasks: preview.tasks, replies: preview.replies,
    getSession: async () => ({ session: {}, events: [{ type: 'assistant/message', data: { message: { id: 'done', content: [{ type: 'text', text: '正文' }] } } }] }) });
  const send = () => handler(new Request('http://localhost/api/lease-voice/synthesize', { method: 'POST', body: JSON.stringify({ chime: true, automatic: true, sessionId: 'main', messageId: 'done', clientId: 'window' }) }));
  const response = await send(); assert.equal(response.status, 202);
  assert.equal(played.length, 1); assert.equal(played[0].format, 'pcm_s16le');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await (await send()).json()).duplicate, true);
});
