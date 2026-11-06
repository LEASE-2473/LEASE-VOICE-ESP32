import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { createPreview } from '../scripts/preview.mjs';
import { displayDevice } from './helpers/display-device.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'lease-background-'));
const device = await displayDevice({ delay: 40 });
const preview = await createPreview({ dataDir: temporary, mediaOptions: { home: join(temporary, 'empty') } });
preview.store.save({ device: { endpoint: device.endpoint, token: device.token } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const errors = [];
const wait = async predicate => { for (let n = 0; n < 400; n++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw Error('等待后台条件超时'); };
const call = async (action, expected = 200) => {
  const response = await fetch(`${preview.url}/api/lease-voice/screen-playback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
  assert.equal(response.status, expected); return response.json();
};
try {
  let page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${preview.url}/api/lease-voice/screen`);
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('素材库已读取'));
  const red = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 64, 64); return canvas.toDataURL().split(',')[1];
  }), 'base64');
  await page.locator('#media-upload').setInputFiles({ name: '后台红色.png', mimeType: 'image/png', buffer: red });
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('已导入 1'));
  await page.getByRole('button', { name: '添加 后台红色.png', exact: true }).click();
  await page.locator('#screen-push-start').click();
  await wait(() => preview.background.view().frames >= 2);
  assert.equal(device.frames[0].length, 40960); assert.equal(device.frames[0].readUInt16BE((80 * 128 + 64) * 2), 0xf800);
  assert.equal(device.frames[0].readUInt16BE(0), 0x10a3, 'contain保留上下背景，不拉伸素材');
  const firstStream = device.state.streamId;
  await page.goto(`${preview.url}/api/lease-voice/extensions`);
  let count = device.frames.length; await wait(() => device.frames.length >= count + 4);
  assert.equal(device.state.streamId, firstStream, '切换页面不能停止或重建后台流');
  await page.close(); count = device.frames.length; await wait(() => device.frames.length >= count + 4);
  assert.equal(device.maxInFlight, 1);
  page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${preview.url}/api/lease-voice/screen`);
  await page.waitForFunction(() => document.querySelector('#screen-push-status').textContent.includes('后台推送中'));
  await page.locator('#background-pause').click(); await wait(() => preview.background.view().state === 'paused');
  count = device.frames.length; await wait(() => device.frames.length >= count + 2);
  await page.locator('#background-resume').click(); await wait(() => preview.background.view().state === 'running');
  await page.locator('#background-next').click();
  await page.locator('#screen-push-stop').click(); await wait(() => preview.background.view().state === 'idle');
  assert.equal(device.state.streamId, ''); assert.equal(preview.background.current, null);
  console.log('实际控制页切换/关闭后后台红色RGB565仍持续；返回可控制，暂停保持帧，停止释放流。');
  const pet = 'D:/LEASE AI Software/Deepseek Harness/profiles/web/node_modules/dsh-pet/assets/webm';
  if (existsSync(pet)) {
    const media = await preview.media.update({ roots: { pet, meme: '' } }); const item = media.items.find(x => x.source === 'pet');
    await preview.media.update({ playlist: [item.id], playback: { fit: 'cover' } });
    await call('start'); await page.close();
    const before = device.frames.length; await wait(() => device.frames.length >= before + 12);
    const frames = device.frames.slice(before); assert.ok(frames.some(x => !x.equals(frames[0])), '真实pet后台解码应持续产生不同画面');
    console.log('真实pet VP9无头后台解码/多帧RGB565推送通过。');
  }
  await preview.background.dispose(); assert.equal(device.state.streamId, ''); assert.equal(preview.background.current, null);
  await call('invalid', 400); assert.deepEqual(errors, []);
  console.log('后台浏览器回归通过；未访问真实设备或调用TTS。');
} finally { await browser.close(); await preview.close(); await device.close(); await rm(temporary, { recursive: true, force: true }); }
