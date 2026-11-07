import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createPreview, sampleWav } from '../scripts/preview.mjs';
import { readSoundWav } from '../core/sounds.js';

const dataDir = await mkdtemp(join(tmpdir(), 'lease-sounds-browser-'));
const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url)); await mkdir(artifacts, { recursive: true });
let synthesized = 0;
const preview = await createPreview({ dataDir, synth: async () => { synthesized++; return { bytes: sampleWav(), mime: 'audio/wav' }; } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const notice = text => page.waitForFunction(text => document.getElementById('notice').textContent.includes(text), text);
try {
  await page.goto(`${preview.url}/api/lease-voice/ui?tab=config`); await notice('配置已读取');
  await page.locator('#download-audio').click(); await notice('请先完成一次合成');
  await page.locator('#listen').click();
  await page.waitForFunction(() => document.getElementById('play-status').textContent === '播放完成');
  await page.locator('#audio-save-name').fill('保存测试'); await page.locator('#save-audio').click(); await notice('已保存到电脑提示素材库');
  assert.equal(synthesized, 1); assert.equal(preview.sounds.view().items[0].name, '保存测试');
  const downloadPromise = page.waitForEvent('download'); await page.locator('#download-audio').click();
  const download = await downloadPromise; assert.equal(download.suggestedFilename(), '保存测试.wav');
  const pcm = readSoundWav(await readFile(await download.path())); assert.ok(pcm.length > 0); assert.equal(synthesized, 1);
  await page.goto(`${preview.url}/api/lease-voice/screen`); await notice('素材库已读取');
  assert.equal(await page.locator('#completion-enabled').isChecked(), false);
  await page.locator('#sound-upload').setInputFiles({ name: '第二段.wav', mimeType: 'audio/wav', buffer: sampleWav() });
  await notice('已导入 1 段提示音');
  // WAV与刚保存的同一模拟声音去重，仍只一条。
  assert.equal(preview.sounds.view().items.length, 1);
  const actualMp3 = fileURLToPath(new URL('../../../assets/任务完成.mp3', import.meta.url));
  if (existsSync(actualMp3)) {
    await page.locator('#sound-upload').setInputFiles(actualMp3); await notice('已导入 1 段提示音');
    assert.ok(preview.sounds.view().items.some(item => item.name === '任务完成' && item.seconds > 1 && item.seconds < 2));
    console.log('真实用户MP3浏览器解码、转换与入库通过。');
  }
  await page.locator('#completion-sound').selectOption('random');
  await page.getByRole('button', { name: '保存提示设置', exact: true }).click(); await notice('完成提示设置已保存');
  assert.equal(preview.store.get().completion.sound, 'random'); assert.ok(preview.store.get().completion.clipIds.length);
  await page.locator('#completion-test').click();
  await page.waitForFunction(() => document.getElementById('completion-status').textContent === '播放完成');
  assert.equal(synthesized, 1, '素材播放不能调用TTS');
  await page.reload(); await notice('素材库已读取'); assert.equal(await page.locator('#completion-sound').inputValue(), 'random');
  assert.ok(await page.locator('#sound-list input:checked').count());
  await page.screenshot({ path: join(artifacts, 'completion-sounds-desktop.png'), fullPage: true });
  const before = preview.sounds.view().items.length;
  await page.locator('#sound-upload').setInputFiles({ name: '伪装.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('<html>bad</html>') });
  await notice('已导入 0 段提示音'); assert.equal(preview.sounds.view().items.length, before);
  await page.getByRole('button', { name: '保存提示设置', exact: true }).click(); await notice('完成提示设置已保存');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('提示音浏览器通过：合成后保存/下载无重合成、WAV/MP3解码/去重、随机选择/试听/持久化、坏文件与移动布局。');
} finally { await browser.close(); await preview.close(); }
