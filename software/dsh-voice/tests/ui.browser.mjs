import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createPreview, sampleWav } from '../scripts/preview.mjs';
import { ReplyTracker } from '../core/replies.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = join(root, 'artifacts'); mkdirSync(artifacts, { recursive: true });
const client = readFileSync(new URL('../client/index.js', import.meta.url), 'utf8');
const harness = await build({ stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
const rows=[]; const effects=[];
window.__ModuleLoader__={load(def){
 const plugin=def.factory(name=>{if(name==='react')return React;throw new Error(name)});
 plugin.apply({get:()=>({inject:(name,fn)=>fn(),register:(meta,render)=>rows.push({meta,render})}),effect:fn=>effects.push(fn())});
 window.voiceSlots=rows.map(row=>row.meta);
 function App(){const [page,setPage]=React.useState('chat'); const [sessionId,setSession]=React.useState('main');
 window.voiceSetSession=setSession;
 const render=id=>rows.find(row=>row.meta.id===id).render({sessionId,messageId:'manual-final'});
 return React.createElement(React.Fragment,null,
  React.createElement('div',{id:'host-controls'},render('lease-voice-controls')),
  React.createElement('button',{onClick:()=>setPage('voice')},'语音设置入口'),React.createElement('button',{onClick:()=>setPage('extension')},'扩展设置入口'),React.createElement('button',{onClick:()=>setPage('chat')},'聊天入口'),
  page==='voice'?render('lease-voice'):page==='extension'?render('lease-voice-extensions'):React.createElement('div',{id:'host-action'},render('lease-voice-speak')));
 }
 createRoot(document.getElementById('root')).render(React.createElement(App));
}};
${client}`, resolveDir: root, sourcefile: 'harness.jsx', loader: 'jsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['/api/*'] });
const extras = new Map([
  ['/harness', { type: 'text/html; charset=utf-8', body: '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>' }],
  ['/harness.js', { type: 'text/javascript', body: harness.outputFiles[0].text }],
]);
const snapshots = new Map([['main', { session: {}, events: [{ type: 'assistant/message', data: { message: { id: 'manual-final', content: [{ type: 'text', text: '手动朗读正文' }] } } }] }]]);
let calls = 0;
const replies = new ReplyTracker();
const preview = await createPreview({ extraAssets: extras, replies, getSession: id => snapshots.get(id), synth: async provider => { calls++; return provider.audioFormat === 'pcm' ? { bytes: sampleWav().subarray(44), mime: 'audio/pcm', sampleRate: 24000, channels: 1, format: 'pcm_s16le' } : { bytes: sampleWav(), mime: 'audio/wav' }; } });
const commands = [];
const uploads = [];
let playbackId = "";
const device = createServer(async (req, res) => {
  if (req.headers.authorization !== 'Bearer board-token') { res.writeHead(401); res.end(); return; }
  res.setHeader('Content-Type', 'application/json');
  if (req.url.endsWith('/info')) { res.end(JSON.stringify({ protocol: 1, kind: 'lease-voice-esp32', name: '隔离协议模拟器', firmware: 'test-1', capabilities: ['test-tone', 'volume', 'audio-pcm16', 'playback-status'] })); return; }
  if (req.url.endsWith('/playback')) { res.end(JSON.stringify({ protocol: 1, id: playbackId, state: 'completed' })); return; }
  if (req.url.endsWith('/audio')) {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    playbackId = req.headers['x-lease-audio-id']; uploads.push(Buffer.concat(chunks));
    assert.equal(req.headers['x-lease-sample-rate'], '24000');
    res.writeHead(202); res.end(JSON.stringify({ protocol: 1, ok: true, id: playbackId, state: 'playing' })); return;
  }
  let raw = ''; for await (const chunk of req) raw += chunk; commands.push(JSON.parse(raw)); res.end('{"protocol":1,"ok":true}');
});
await new Promise(resolve => device.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const errors = [];
const context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, colorScheme: 'dark' });
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
async function status(text) { await page.waitForFunction(value => document.getElementById('notice')?.textContent.includes(value), text); }
function publish(id) {
  const target = { id: 'main', header: {} };
  const events = [
    { type: 'turn/start', data: { turn: 3 } },
    { type: 'user/message', data: { source: { kind: 'user-rpc' } } },
    { type: 'assistant/message', data: { turn: 3, step: 1, message: { id, content: [{ type: 'text', text: `自动朗读 ${id}` }] } } },
    { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } },
  ];
  snapshots.get('main').events.push(events[2]);
  for (const event of events) replies.consume(target, event);
}
try {
  await page.goto(`${preview.url}/api/lease-voice/ui`); await status('配置已读取');
  assert.equal(await page.locator('#transport').inputValue(), 'websocket');
  assert.equal(await page.locator('#endpoint').inputValue(), 'wss://openspeech.bytedance.com/api/v3/tts/bidirection');
  await page.locator('#transport').selectOption('sse');
  assert.equal(await page.locator('#endpoint').inputValue(), 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse');
  await page.locator('#transport').selectOption('websocket');
  assert.equal(await page.locator('#endpoint').inputValue(), 'wss://openspeech.bytedance.com/api/v3/tts/bidirection');
  await page.locator('#api-key').fill('fake-key'); await page.locator('input[value=auto]').check();
  await page.getByRole('button', { name: '保存语音设置' }).click(); await status('语音设置已保存');
  assert.equal(await page.locator('#api-key').inputValue(), ''); assert.match(await page.locator('#key-state').textContent(), /已保存/);
  await page.locator('#provider').selectOption('minimax'); assert.equal(await page.locator('#model-field').isVisible(), true); assert.equal(await page.locator('#resource-field').isVisible(), false);
  await page.locator('#model').fill('test-model'); await page.locator('#voice').fill('test-voice'); await page.locator('#api-key').fill('mini-key');
  await page.getByRole('button', { name: '保存语音设置' }).click(); await status('语音设置已保存');
  await page.reload(); await status('配置已读取'); assert.equal(await page.locator('#provider').inputValue(), 'minimax');
  await page.locator('#provider').selectOption('volcengine'); assert.equal(await page.locator('#voice').inputValue(), 'zh_female_vv_uranus_bigtts');
  await page.getByRole('button', { name: '保存语音设置' }).click(); await status('语音设置已保存');
  await page.getByRole('button', { name: '启用声音 / 继续播放' }).click();
  await page.getByRole('button', { name: '合成并试听' }).click(); await page.waitForFunction(() => document.getElementById('play-status').textContent === '播放完成');
  assert.equal(calls, 1);
  await page.screenshot({ path: join(artifacts, 'voice-settings.png'), fullPage: true });
  await page.goto(`${preview.url}/api/lease-voice/extensions`); await status('配置已读取');
  await page.locator('#device-endpoint').fill(`http://127.0.0.1:${device.address().port}`); await page.locator('#device-token').fill('board-token');
  await page.getByRole('button', { name: '保存设备', exact: true }).click(); await status('设备配置已保存');
  await page.getByRole('button', { name: '连接检查' }).click(); await status('调试操作完成');
  assert.match(await page.locator('#connection-state').textContent(), /已连接/);
  await page.locator('#device-volume').evaluate(el => { el.value = '37'; el.dispatchEvent(new Event('input', { bubbles: true })); }); await page.getByRole('button', { name: '设置音量' }).click(); await status('调试操作完成');
  await page.getByRole('button', { name: '播放设备测试音' }).click(); await status('调试操作完成');
  assert.deepEqual(commands.map(c => c.action), ['volume', 'test-tone']); assert.equal(commands[0].value, 37);
  await page.screenshot({ path: join(artifacts, 'esp32-extension.png'), fullPage: true });

  await page.goto(`${preview.url}/harness`);
  await page.waitForSelector('#host-controls button');
  const slots = await page.evaluate(() => window.voiceSlots);
  assert.equal(slots.filter(s => s.name === 'settings.section').length, 2);
  await page.getByRole('button', { name: '语音设置入口', exact: true }).click();
  await page.frameLocator('iframe').locator('#provider').waitFor();
  await page.getByRole('button', { name: '扩展设置入口', exact: true }).click();
  await page.frameLocator('iframe').locator('#device-endpoint').waitFor();
  await page.getByRole('button', { name: '聊天入口', exact: true }).click();
  await page.getByRole('button', { name: '启用声音', exact: true }).click();
  const beforeManual = calls;
  await page.getByRole('button', { name: '转语音', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#host-controls [role=status]')?.textContent === '播放完成');
  assert.equal(calls, beforeManual + 1);
  const second = await context.newPage(); second.on('pageerror', e => errors.push(e.message));
  await second.goto(`${preview.url}/harness`); await second.waitForSelector('#host-controls button');
  await page.bringToFront();
  await new Promise(resolve => setTimeout(resolve, 1900));
  const beforeAuto = calls;
  publish('auto-first');
  await page.waitForFunction(() => document.querySelector('#host-controls [role=status]')?.textContent === '播放完成');
  await new Promise(resolve => setTimeout(resolve, 2200));
  assert.equal(calls, beforeAuto + 1, '双窗口只能创建一份自动音频');
  // 完成提示与自动朗读独立：手动模式也能叮，双窗口不重复、不调用 TTS。
  preview.store.save({ mode: 'manual', completion: { enabled: true, target: 'browser' } });
  await new Promise(resolve => setTimeout(resolve, 1900));
  const chimes = [];
  const observe = request => { if (request.url().endsWith('/synthesize') && request.postDataJSON()?.chime) chimes.push(request.postDataJSON()); };
  page.on('request', observe); second.on('request', observe);
  const beforeDing = calls;
  publish('completion-only');
  await page.waitForFunction(() => document.querySelector('#host-controls [role=status]')?.textContent === '播放完成');
  await new Promise(resolve => setTimeout(resolve, 2200));
  assert.equal(chimes.length, 1, '手动模式完成提示仅播放一次'); assert.equal(calls, beforeDing, '叮声不应调用 TTS');
  // 同一条回复先完成提示，再朗读正文。
  preview.store.save({ mode: 'auto' });
  await new Promise(resolve => setTimeout(resolve, 1900));
  const order = [];
  page.on('request', request => {
    if (request.url().endsWith('/synthesize')) order.push(request.postDataJSON()?.chime ? 'chime' : 'speech');
  });
  publish('speech-then-ding');
  await new Promise(resolve => setTimeout(resolve, 4000));
  assert.deepEqual(order, ['chime', 'speech']);
  assert.equal(calls, beforeDing + 1);
  const beforeRefresh = calls, beforeChimeRefresh = chimes.length;
  await page.reload(); await page.waitForSelector('#host-controls button'); await new Promise(resolve => setTimeout(resolve, 1800));
  assert.equal(calls, beforeRefresh, '刷新不应重播旧回复'); assert.equal(chimes.length, beforeChimeRefresh, '刷新不补播旧提示');
  await page.evaluate(() => window.voiceSetSession('other')); await new Promise(resolve => setTimeout(resolve, 1800));
  publish('main-hidden'); await new Promise(resolve => setTimeout(resolve, 1800));
  assert.equal(calls, beforeRefresh, '切换会话后不应朗读旧会话'); assert.equal(chimes.length, beforeChimeRefresh);
  preview.store.save({ completion: { enabled: false } });
  await second.close();
  assert.deepEqual(errors, []);
  const insecure = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  await insecure.addInitScript(() => { Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined, configurable: true }); });
  const mobile = await insecure.newPage(); mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(`${preview.url}/api/lease-voice/ui`);
  await mobile.waitForFunction(() => document.getElementById('notice').textContent.includes('配置已读取'));
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.screenshot({ path: join(artifacts, 'voice-mobile-light.png'), fullPage: true });
  await insecure.close();
  assert.deepEqual(errors, []);
  await page.goto(`${preview.url}/api/lease-voice/ui`); await status('配置已读取');
  await page.locator('#output-target').selectOption('esp32');
  await page.getByRole('button', { name: '保存语音设置' }).click(); await status('语音设置已保存');
  await page.reload(); await status('配置已读取');
  assert.equal(await page.locator('#output-target').inputValue(), 'esp32');
  await page.getByRole('button', { name: '合成并试听' }).click();
  await page.waitForFunction(() => document.getElementById('play-status').textContent === '设备播放完成');
  assert.equal(uploads.length, 1); assert.ok(uploads[0].length > 0);
  assert.deepEqual(errors, []);
  console.log('浏览器通过：两设置页注册/iframe、provider 切换与保存、密钥脱敏、试听播放、设备协议调试、真实 React 消息按钮、自动朗读双窗口去重、刷新与切换会话；无页面 JS 错误。');
  console.log(`截图：${artifacts}`);
} finally {
  await browser.close(); await preview.close(); device.closeAllConnections(); await new Promise(resolve => device.close(resolve));
}
