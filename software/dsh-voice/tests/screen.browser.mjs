import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createPreview } from '../scripts/preview.mjs';
import { displayDevice } from './helpers/display-device.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'lease-screen-browser-'));
const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url)); await mkdir(artifacts, { recursive: true });
const preview = await createPreview({ dataDir: join(temporary, 'data'), mediaOptions: { home: join(temporary, 'empty-home') } });
const device = await displayDevice({ delay: 40 });
preview.store.save({ device: { endpoint: device.endpoint, token: device.token } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const errors = [], violations = [];
const context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, colorScheme: 'dark' });
await context.addInitScript(() => { window.cspViolations = []; document.addEventListener('securitypolicyviolation', e => window.cspViolations.push(e.violatedDirective)); });
const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
async function status(text) { await page.waitForFunction(value => document.querySelector('#notice')?.textContent.includes(value), text); }
async function playing() {
  try { await page.waitForFunction(() => document.querySelector('#screen-status')?.textContent === '预览播放中'); }
  catch (error) {
    console.log('播放失败诊断', await page.evaluate(() => ({ status: document.querySelector('#screen-status')?.textContent, current: document.querySelector('#screen-current')?.textContent, video: [...document.querySelectorAll('video')].map(x => ({ ready: x.readyState, network: x.networkState, error: x.error?.code, duration: x.duration })) })));
    throw error;
  }
}
const current = () => page.locator('#screen-current').textContent();
const center = () => page.locator('#screen-canvas').evaluate(canvas => [...canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data]);
try {
  await page.goto(`${preview.url}/api/lease-voice/screen`); await status('素材库已读取');
  assert.match(await page.locator('.intro').textContent(), /实际效果以现场屏幕为准/);
  await page.locator('#screen-start').click(); assert.match(await page.locator('#screen-status').textContent(), /先添加/);
  const image = async color => Buffer.from(await page.evaluate(color => { const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 32; const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 64, 32); return canvas.toDataURL('image/png').split(',')[1]; }, color), 'base64');
  const red = await image('#ff0000'), blue = await image('#0000ff');
  await page.locator('#media-upload').setInputFiles([{ name: '红色.png', mimeType: 'image/png', buffer: red }, { name: '蓝色.png', mimeType: 'image/png', buffer: blue }]);
  await status('已导入 2 个文件');
  await page.getByRole('button', { name: '添加 红色.png', exact: true }).click();
  await page.getByRole('button', { name: '添加 蓝色.png', exact: true }).click();
  await page.locator('#screen-seconds').fill('1');
  await page.getByRole('button', { name: '保存播放方案', exact: true }).click(); await status('播放方案已保存');
  await page.reload(); await status('素材库已读取');
  assert.equal(await page.locator('#playlist li').count(), 2);
  assert.equal(await page.locator('#screen-seconds').inputValue(), '1');
  await page.locator('#screen-start').click(); await playing();
  assert.equal(await current(), '红色.png'); assert.deepEqual(await center(), [255, 0, 0, 255]);
  assert.deepEqual(await page.locator('#screen-canvas').evaluate(canvas => [...canvas.getContext('2d').getImageData(0, 0, 1, 1).data]), [16, 21, 29, 255], '完整显示应保留背景边缘');
  await page.locator('#screen-pause').click(); const paused = await current();
  await page.waitForTimeout(1300); assert.equal(await current(), paused);
  await page.locator('#screen-start').click(); await playing();
  await page.waitForFunction(() => document.querySelector('#screen-current').textContent === '蓝色.png');
  await page.locator('#screen-pause').click(); assert.deepEqual(await center(), [0, 0, 255, 255]);
  const edgeBeforeZoom = await page.locator('#screen-canvas').evaluate(canvas => [...canvas.getContext('2d').getImageData(0, 35, 1, 1).data]);
  assert.deepEqual(edgeBeforeZoom, [16, 21, 29, 255]);
  await page.locator('#screen-zoom').fill('1.5');
  await page.getByRole('button', { name: '保存播放方案', exact: true }).click(); await status('播放方案已保存');
  await page.locator('#screen-start').click(); await playing(); await page.locator('#screen-pause').click();
  assert.deepEqual(await page.locator('#screen-canvas').evaluate(canvas => [...canvas.getContext('2d').getImageData(0, 35, 1, 1).data]), [255, 0, 0, 255], '缩放应扩大实际像素覆盖范围');
  await page.reload(); await status('素材库已读取'); assert.equal(await page.locator('#screen-zoom').inputValue(), '1.5');
  await page.locator('#screen-zoom').fill('1');
  await page.getByRole('button', { name: '上移 蓝色.png', exact: true }).click();
  await page.locator('#screen-order').selectOption('random'); await page.locator('#screen-fit').selectOption('cover');
  await page.locator('#screen-size').selectOption('240x240'); await page.locator('#screen-seconds').fill('2');
  await page.getByRole('button', { name: '保存播放方案', exact: true }).click(); await status('播放方案已保存');
  await page.locator('#screen-start').click(); await playing(); const before = await current();
  await page.locator('#screen-next').click(); await playing(); assert.notEqual(await current(), before, '多项随机应避免紧邻重复');
  await page.locator('#screen-pause').click();
  assert.equal(await page.locator('#screen-canvas').getAttribute('width'), '240');
  assert.notDeepEqual(await page.locator('#screen-canvas').evaluate(canvas => [...canvas.getContext('2d').getImageData(0, 0, 1, 1).data]), [16, 21, 29, 255], '铺满屏幕应裁切并覆盖边缘');
  await page.screenshot({ path: join(artifacts, 'screen-desktop.png'), fullPage: true });
  await page.locator('#screen-stop').click(); assert.equal(await page.locator('#screen-status').textContent(), '预览已停止');

  // 浏览器像素→RGB565→电脑转发→Node协议模拟器，非实物C/SPI验收。
  await page.locator('#screen-device-check').click(); await status('设备支持画面接收');
  await page.locator('#screen-size').selectOption('128x160');
  await page.getByRole('button', { name: '保存播放方案', exact: true }).click(); await status('播放方案已保存');
  await page.locator('#screen-push-pattern').click();
  await page.waitForFunction(() => document.querySelector('#screen-push-status').textContent.includes('已接收 2 帧'));
  assert.equal(device.frames[0].length, 128 * 160 * 2);
  const color = x => device.frames[0].readUInt16BE(x * 2);
  assert.deepEqual([color(0), color(30), color(60), color(90), color(120)], [0xf800, 0x07e0, 0x001f, 0xffff, 0]);
  assert.equal(device.maxInFlight, 1, '按接收确认串行发送，不堆积帧');
  await page.locator('#screen-push-stop').click();
  await page.waitForFunction(() => document.querySelector('#screen-push-status').textContent === '设备画面已停止');
  assert.equal(device.state.streamId, '');
  const stoppedFrames = device.frames.length; await page.waitForTimeout(400); assert.equal(device.frames.length, stoppedFrames);
  await page.locator('#screen-push-start').click();
  await page.waitForFunction(() => document.querySelector('#screen-push-status').textContent.includes('已接收 1 帧'));
  await page.locator('#screen-push-stop').click();
  await page.waitForFunction(() => document.querySelector('#screen-push-status').textContent === '设备画面已停止');

  // 由浏览器编码一段测试 WebM，验证真实解码、暂停及视频结束后切换。
  const video = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const stream = canvas.captureStream(12), recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks = []; recorder.ondataavailable = e => chunks.push(e.data);
    const done = new Promise(resolve => { recorder.onstop = resolve; }); recorder.start(100);
    let frame = 0;
    const ctx = canvas.getContext('2d'); const paint = () => { ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 64, 64); ctx.fillStyle = ++frame % 2 ? '#0000ff' : '#00ff00'; ctx.fillRect(0, 0, 1, 1); };
    paint(); const timer = setInterval(paint, 70); await new Promise(resolve => setTimeout(resolve, 1500));
    recorder.stop(); await done; clearInterval(timer); stream.getTracks().forEach(track => track.stop());
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
  });
  await writeFile(join(artifacts, 'screen-recorded-fixture.webm'), Buffer.from(video));
  await page.locator('#media-upload').setInputFiles({ name: '测试视频.webm', mimeType: 'video/webm', buffer: Buffer.from(video) }); await status('已导入 1 个文件');
  const recordedItem = preview.media.view().items.find(item => item.name === '测试视频.webm');
  const roundTrip = await fetch(`${preview.url}/api/lease-voice/media-file?id=${recordedItem.id}`);
  assert.equal(roundTrip.status, 200); assert.equal(roundTrip.headers.get('Content-Type'), 'video/webm');
  assert.deepEqual(Buffer.from(await roundTrip.arrayBuffer()), Buffer.from(video), '录制视频字节应完整往返');
  await page.getByRole('button', { name: '预览 测试视频.webm', exact: true }).click(); await playing();
  assert.deepEqual(await center(), [0, 255, 0, 255]);
  await page.waitForTimeout(1800);
  assert.equal(await current(), '测试视频.webm'); assert.deepEqual(await center(), [0, 255, 0, 255]);
  assert.equal(await page.locator('#screen-status').textContent(), '预览播放中', '单视频播放结束应循环');
  await page.locator('#screen-pause').click(); await page.waitForTimeout(900);
  assert.equal(await page.locator('#screen-status').textContent(), '预览已暂停');
  await page.getByRole('button', { name: '预览 测试视频.webm', exact: true }).click(); await playing();
  assert.equal(await current(), '测试视频.webm');
  await page.locator('#screen-stop').click();
  await page.locator('#completion-test').click();
  await page.waitForFunction(() => document.querySelector('#completion-status').textContent === '播放完成');
  await page.locator('#completion-enabled').check(); await page.locator('#completion-volume').fill('25');
  await page.getByRole('button', { name: '保存提示设置', exact: true }).click(); await status('完成提示设置已保存');
  await page.reload(); await status('素材库已读取'); assert.equal(await page.locator('#completion-enabled').isChecked(), true);
  assert.equal(await page.locator('#completion-volume').inputValue(), '25');

  await page.locator('#media-upload').setInputFiles({ name: '伪装.png', mimeType: 'image/png', buffer: Buffer.from('<html>bad</html>') });
  await status('已导入 0 个文件'); assert.match(await page.locator('#notice').textContent(), /格式/);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除 蓝色.png', exact: true }).click(); await status('已删除本地导入文件');
  assert.equal(await page.locator('#playlist li').count(), 1);
  violations.push(...await page.evaluate(() => window.cspViolations));

  // 本机真实素材只读验收：不作为发布包素材。
  const actualHome = process.env.DSH_ROOT || 'D:/LEASE AI Software/Deepseek Harness';
  const actualPet = join(actualHome, 'profiles/web/node_modules/dsh-pet/assets/webm');
  if (existsSync(actualPet)) {
    await preview.media.update({ roots: { pet: actualPet, meme: join(actualHome, 'meme-packs') } });
    await page.locator('#media-refresh').click(); await status('素材库已刷新');
    assert.ok(preview.media.view().items.some(x => x.source === 'pet'));
    await page.locator('#media-source').selectOption('pet');
    await page.getByRole('button', { name: /^预览 / }).first().click(); await playing();
    await page.waitForTimeout(500);
    const visiblePixels = await page.locator('#screen-canvas').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] !== 16 || pixels[i + 1] !== 21 || pixels[i + 2] !== 29) count++;
      return count;
    });
    assert.ok(visiblePixels > 100, '真实 VP9 透明动画应产生可见画面');
    await page.locator('#screen-pause').click();
    await page.screenshot({ path: join(artifacts, 'screen-real-pet.png'), fullPage: true });
    console.log(`本机只读素材通过：${preview.media.view().items.filter(x => x.source === 'pet').length} 个 pet 动画，VP9 实际解码并绘制。`);
  } else console.log('本机 pet 验收未执行：未找到素材目录。');

  const mobile = await context.newPage(); mobile.on('pageerror', e => errors.push(e.message));
  await mobile.setViewportSize({ width: 390, height: 844 }); await mobile.emulateMedia({ colorScheme: 'light' });
  await mobile.goto(`${preview.url}/api/lease-voice/screen`); await mobile.waitForFunction(() => document.querySelector('#notice').textContent.includes('素材库已读取'));
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.screenshot({ path: join(artifacts, 'screen-mobile-light.png'), fullPage: true });
  violations.push(...await mobile.evaluate(() => window.cspViolations));
  assert.deepEqual(errors, []); assert.deepEqual(violations, []);
  console.log('屏幕浏览器通过：导入/持久化/重排/随机/适配/暂停/视频循环/提示音/删除/错误文件/移动布局；无 JS 或 CSP 错误。');
} finally {
  await browser.close(); await preview.close(); await device.close(); await rm(temporary, { recursive: true, force: true });
}
