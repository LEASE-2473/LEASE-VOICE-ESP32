import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { speechText, splitText } from '../core/text.js';
import { defaultConfig, updateConfig, createConfigStore } from '../host/config.js';
import { buildRequest, synthesize, decodeVolcSSE, VOLC_ENDPOINTS } from '../providers/tts.js';
import { ReplyTracker, readMessage } from '../core/replies.js';
import { TaskService } from '../core/tasks.js';
import { createPreview } from '../scripts/preview.mjs';
import { debugDevice } from '../extensions/esp32.js';

test('正文整理不包含思考/工具，分段保留完整 Unicode 文本', () => {
  assert.equal(speechText([{ type: 'reasoning', text: '秘密' }, { type: 'text', text: '**你好** [世界](https://example.com)\n```js\npassword\n```\n![图](file.png)' }, { type: 'tool-call', name: 'x' }]), '你好 世界');
  const text = '😀你好世界。'.repeat(400);
  const parts = splitText(text);
  assert.equal(parts.join(''), text);
  assert.ok(parts.every(part => Array.from(part).length <= 800));
});

test('配置按 provider 保存、脱敏、空密钥保留、显式清除及重载', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lease-voice-config-'));
  const store = createConfigStore(directory);
  store.save({ provider: { id: 'volcengine', apiKey: 'secret', appId: 'app', accessToken: 'token' }, mode: 'auto' });
  const view = store.save({ provider: { id: 'volcengine', apiKey: '', voice: 'new-voice' }, device: { token: 'device-secret' } });
  assert.equal(store.get().providers.volcengine.apiKey, 'secret');
  assert.equal(JSON.stringify(view).includes('secret'), false);
  assert.equal(view.providers.volcengine.apiKeySet, true);
  assert.equal(createConfigStore(directory).get().mode, 'auto');
  store.save({ provider: { id: 'volcengine', clearApiKey: true } });
  assert.equal(store.get().providers.volcengine.apiKey, '');
  assert.throws(() => store.save({ provider: { id: 'volcengine', speed: 0.2 } }));
  assert.throws(() => store.save({ provider: { id: '__proto__' } }));
  assert.throws(() => store.save({ provider: { id: 'openai', endpoint: 'file:///secret' } }));
  assert.equal(JSON.parse(readFileSync(join(directory, 'config.json'))).providers.volcengine.voice, 'new-voice');
});

test('三种 provider 使用各自请求、鉴权与音频解码，不发 instructions', async () => {
  const config = defaultConfig();
  const volc = { ...config.providers.volcengine, transport: 'sse', endpoint: VOLC_ENDPOINTS.sse, apiKey: 'key' };
  const v = buildRequest(volc, '你好');
  assert.equal(v.headers['X-Api-Key'], 'key');
  assert.equal(v.body.req_params.speaker, volc.voice);
  assert.equal(v.body.req_params.audio_params.speech_rate, 0);
  assert.equal(v.body.req_params.audio_params.sample_rate, 24000);
  assert.equal(v.body.req_params.sample_rate, undefined);
  assert.equal(v.body.req_params.audio_params.bit_rate, undefined);
  const legacy = buildRequest({ ...volc, authMode: 'legacy', appId: 'app', accessToken: 'token' }, '你好');
  assert.equal(legacy.headers['X-Api-App-Id'], 'app');
  assert.equal(legacy.headers['X-Api-Access-Key'], 'token');
  assert.equal(legacy.headers['X-Api-Key'], undefined);
  const bytes = Buffer.from('mock audio');
  const vAudio = await synthesize(volc, '你好', undefined, async (url, init) => {
    assert.equal(init.redirect, 'error');
    assert.equal(JSON.stringify(JSON.parse(init.body)).includes('instructions'), false);
    return new Response(`data: ${JSON.stringify({ code: 0, data: bytes.toString('base64') })}\r\n\r\ndata: {"code":20000000}\r\n\r\n`);
  });
  assert.deepEqual(vAudio.bytes, bytes);
  const speech = { ...config.providers.openai, endpoint: 'http://localhost/v1/audio/speech', model: 'model', voice: 'voice', apiKey: 'key' };
  const o = buildRequest(speech, '正文');
  assert.deepEqual(o.body, { input: '正文', model: 'model', voice: 'voice', speed: 1, response_format: 'mp3' });
  assert.equal(o.headers.Authorization, 'Bearer key');
  assert.deepEqual((await synthesize(speech, '正文', undefined, async () => new Response(bytes, { headers: { 'Content-Type': 'audio/mpeg' } }))).bytes, bytes);
  const minimax = { ...config.providers.minimax, model: 'model', voice: 'voice', apiKey: 'key' };
  const m = buildRequest(minimax, '正文');
  assert.equal(m.body.output_format, 'hex'); assert.equal(m.body.stream, false);
  assert.deepEqual((await synthesize(minimax, '正文', undefined, async () => Response.json({ base_resp: { status_code: 0 }, data: { audio: bytes.toString('hex') } }))).bytes, bytes);
});

test('旧火山默认配置在内存适配 WebSocket，保留凭据与原配置文件；自定义 SSE 地址保留', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lease-voice-migrate-'));
  const config = defaultConfig();
  delete config.providers.volcengine.transport;
  Object.assign(config.providers.volcengine, { endpoint: VOLC_ENDPOINTS.sse, apiKey: 'private', appId: '123', accessToken: 'access' });
  const file = join(directory, 'config.json');
  const original = JSON.stringify(config);
  writeFileSync(file, original);
  const store = createConfigStore(directory);
  assert.equal(store.get().providers.volcengine.endpoint, VOLC_ENDPOINTS.websocket);
  assert.equal(store.get().providers.volcengine.transport, 'websocket');
  assert.equal(store.get().providers.volcengine.apiKey, 'private');
  assert.equal(store.get().providers.volcengine.accessToken, 'access');
  assert.equal(readFileSync(file, 'utf8'), original);
  assert.ok(store.public().migrationNotice);
  config.providers.volcengine.endpoint = 'https://openspeech.bytedance.com/api/v3/tts/bidirection';
  writeFileSync(file, JSON.stringify(config));
  assert.equal(createConfigStore(directory).get().providers.volcengine.endpoint, VOLC_ENDPOINTS.websocket);
  store.save({ mode: 'manual' });
  assert.equal(JSON.parse(readFileSync(file)).providers.volcengine.transport, 'websocket');
  config.providers.volcengine.endpoint = 'https://custom.example/sse';
  writeFileSync(file, JSON.stringify(config));
  assert.equal(createConfigStore(directory).get().providers.volcengine.transport, 'sse');
  assert.throws(() => updateConfig(defaultConfig(), { provider: { id: 'volcengine', transport: 'websocket', endpoint: VOLC_ENDPOINTS.sse } }), /wss/);
});

test('供应商错误/截断/非音频响应不可伪装为成功且不回显服务端正文', async () => {
  assert.throws(() => decodeVolcSSE('data: {"code":0,"data":"YWJj"}\n\n'), /未正常结束/);
  assert.throws(() => decodeVolcSSE('data: {"code":45000000,"message":"secret"}\n\n'), error => !error.message.includes('secret'));
  const p = { ...defaultConfig().providers.openai, endpoint: 'https://example.com', model: 'm', voice: 'v' };
  await assert.rejects(synthesize(p, '正文', undefined, async () => new Response('secret', { status: 401 })), error => !error.message.includes('secret'));
  await assert.rejects(synthesize(p, '正文', undefined, async () => Response.json({ error: 'secret' })), /未返回音频/);
});

const session = { id: 'main', header: {} };
function emit(tracker, type, data, target = session) { tracker.consume(target, { type, data }); }
function turn(tracker, { source = 'user-rpc', reason = 'completed', interrupted = false, target = session, messageId = 'final' } = {}) {
  emit(tracker, 'turn/start', { turn: 1 }, target);
  emit(tracker, 'user/message', { source: { kind: source }, content: [{ type: 'text', text: '问题' }] }, target);
  emit(tracker, 'assistant/message', { turn: 1, step: 1, message: { id: 'intermediate', content: [{ type: 'text', text: '查一下' }, { type: 'tool-call' }] } }, target);
  emit(tracker, 'assistant/message', { turn: 1, step: 2, interrupted, message: { id: messageId, content: [{ type: 'reasoning', text: '不读' }, { type: 'text', text: '最终正文' }] } }, target);
  emit(tracker, 'turn/end', { turn: 1, reason: { kind: reason } }, target);
}
test('自动只选择主会话真人触发的成功最终消息，工具续轮/重试只出一条', () => {
  const tracker = new ReplyTracker();
  turn(tracker);
  assert.deepEqual(tracker.since('main', 0).events.map(e => e.messageId), ['final']);
  turn(tracker);
  assert.equal(tracker.cursor, 1);
  assert.deepEqual(tracker.since('main', tracker.cursor).events, []);
});
test('取消、后台通知、定时、子代理不自动播；完整历史消息仍可手动读取', () => {
  for (const options of [{ interrupted: true }, { reason: 'aborted' }, { reason: 'failed' }, { source: 'tool-jobs' }, { source: 'schedule' }, { target: { id: 'child', header: { parentSession: 'main' } } }]) {
    const tracker = new ReplyTracker(); turn(tracker, options); assert.equal(tracker.cursor, 0);
  }
  const snapshot = { session: {}, events: [{ type: 'assistant/message', data: { message: { id: 'old', content: [{ type: 'text', text: '历史正文' }] } } }] };
  assert.equal(readMessage(snapshot, 'old'), '历史正文');
  assert.throws(() => readMessage({ ...snapshot, session: { parentSession: 'x' } }, 'old'));
});

const settled = async job => { for (let n = 0; n < 200 && ['queued', 'synthesizing'].includes(job.state); n++) await new Promise(r => setTimeout(r, 5)); return job; };
test('自动租约和消息去重避免双窗口重复合成；重播命中缓存，换音色失效', async () => {
  let config = { ...defaultConfig(), mode: 'auto' }, calls = 0;
  const tasks = new TaskService({ get: () => config }, async () => { calls++; return { bytes: Buffer.from('audio'), mime: 'audio/mpeg' }; });
  assert.equal(tasks.lease('main', 'a'), true); assert.equal(tasks.lease('main', 'b'), false);
  assert.throws(() => tasks.start({ text: '正文', clientId: 'b', sessionId: 'main', autoKey: 'event' }));
  const started = tasks.start({ text: '正文', clientId: 'a', sessionId: 'main', autoKey: 'event' });
  await settled(tasks.get(started.id, 'a'));
  assert.deepEqual(tasks.start({ text: '正文', clientId: 'a', sessionId: 'main', autoKey: 'event' }), { duplicate: true });
  assert.equal(tasks.start({ text: '正文', clientId: 'a' }).id, started.id);
  assert.equal(calls, 1);
  config.providers.volcengine.voice = 'other';
  const second = tasks.start({ text: '正文', clientId: 'a' }); await settled(tasks.get(second.id, 'a')); assert.equal(calls, 2);
  tasks.dispose();
});
test('停止使迟到音频失效，并拒绝取消请求之前发出的迟到合成请求', async () => {
  let resolve;
  const tasks = new TaskService({ get: defaultConfig }, () => new Promise(r => { resolve = r; }));
  const started = tasks.start({ text: '正文', clientId: 'a', generation: 0 });
  const job = tasks.get(started.id, 'a');
  tasks.cancel('a', undefined, 1);
  resolve({ bytes: Buffer.from('late'), mime: 'audio/mpeg' });
  await settled(job);
  assert.equal(job.state, 'canceled'); assert.equal(job.segments.length, 0);
  assert.throws(() => tasks.start({ text: '旧请求', clientId: 'a', generation: 0 }), /停止/);
  tasks.dispose();
});
test('迟到的停止请求不会取消用户随后开始的新一代朗读', async () => {
  const tasks = new TaskService({ get: defaultConfig }, async () => ({ bytes: Buffer.from('audio'), mime: 'audio/mpeg' }));
  const started = tasks.start({ text: '新的朗读', clientId: 'a', generation: 1 });
  tasks.cancel('a', undefined, 1);
  const job = await settled(tasks.get(started.id, 'a'));
  assert.equal(job.state, 'ready');
  tasks.dispose();
});

test('真实 HTTP 配置/任务/音频路由可用，音频按客户端隔离，取消后不可读', async () => {
  const preview = await createPreview();
  try {
    const request = (name, body) => fetch(`${preview.url}/api/lease-voice/${name}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    assert.equal((await request('ui')).headers.get('content-type'), 'text/html; charset=utf-8');
    const saved = await (await request('config', { provider: { id: 'volcengine', apiKey: 'private-key' } })).json();
    assert.equal(JSON.stringify(saved).includes('private-key'), false);
    const job = await (await request('synthesize', { text: '测试', clientId: 'a' })).json();
    await settled(preview.tasks.get(job.id, 'a'));
    assert.equal((await request(`audio?id=${job.id}&clientId=a&segment=0`)).status, 200);
    assert.equal((await request(`audio?id=${job.id}&clientId=b&segment=0`)).status, 400);
    await request('cancel', { clientId: 'a', generation: 1 });
    assert.equal((await request(`audio?id=${job.id}&clientId=a&segment=0`)).status, 400);
    assert.equal((await request('device-debug', { action: 'info' })).status, 400);
  } finally { await preview.close(); }
});
test('ESP32 调试鉴权、能力校验、音量与协议错误', async () => {
  const device = { endpoint: 'http://192.168.1.50', token: 'device-token' };
  const info = await debugDevice(device, 'info', undefined, async (url, init) => {
    assert.equal(url, 'http://192.168.1.50/lease-voice/v1/info');
    assert.equal(init.headers.Authorization, 'Bearer device-token'); assert.equal(init.redirect, 'error');
    return Response.json({ protocol: 1, kind: 'lease-voice-esp32', name: '<script>', firmware: 'dev', capabilities: ['audio', 'test-tone'] });
  });
  assert.equal(info.online, true);
  await debugDevice(device, 'volume', 37, async (url, init) => {
    assert.equal(JSON.parse(init.body).value, 37); return Response.json({ protocol: 1, ok: true });
  });
  await assert.rejects(debugDevice(device, 'volume', 101));
  await assert.rejects(debugDevice(device, 'info', undefined, async () => Response.json({ protocol: 0 })), /协议不匹配/);
});
test('客户端注册两个设置页、回复按钮和会话播放控制，不扫描 DOM', () => {
  const source = readFileSync(new URL('../client/index.js', import.meta.url), 'utf8');
  let definition;
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: value => { definition = value; } } } });
  assert.equal(definition.id, 'dsh-lease-voice');
  // 浏览器测试另外使用真实 React 执行注册、挂载按钮和两个设置页。
  for (const name of ['settings.section', 'lease-voice-extensions', 'conversation.chat.assistant-actions', 'conversation.session.header.utilities']) assert.ok(source.includes(name));
  assert.ok(!source.includes('MutationObserver'));
  assert.ok(!/import\s*\(/.test(source), 'DSH 客户端不得依赖额外 HTTP 动态模块加载');
  assert.ok(/(?:class VoicePlayer|VoicePlayer\s*=\s*class)/.test(source), '播放器必须包含在客户端包内');
});
