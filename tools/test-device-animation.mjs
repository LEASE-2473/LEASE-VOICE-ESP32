// Hardware acceptance through the real screen UI. No paid synthesis or DSH restart.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createPreview } from '../software/dsh-voice/scripts/preview.mjs';
import { DisplayService } from '../software/dsh-voice/extensions/display.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(new URL('../software/dsh-voice/package.json', import.meta.url));
const { chromium } = require('playwright');
const device = JSON.parse(readFileSync(join(root, 'tools/data/device.json'), 'utf8'));
const dataDir = join(root, 'tools/data/screen-acceptance');
const artifacts = join(root, 'firmware/esp32-s3/artifacts/acceptance'); mkdirSync(artifacts, { recursive: true });
const config = { profile: 'st7735-128x160', xGap: 0, yGap: 0, swapXY: true, mirrorX: true, mirrorY: true, bgr: false, invert: false };
const preview = await createPreview({ dataDir, mediaOptions: { home: process.env.DSH_HOME || 'D:/LEASE AI Software/Deepseek Harness' } });
preview.store.save({ device: { endpoint: device.endpoint, token: device.token } });
const observer = new DisplayService(preview.store);
const pet = preview.media.view().items.filter(item => item.source === 'pet').slice(0, 3);
if (!pet.length) { await preview.close(); throw new Error('No pet animations found'); }
await preview.media.update({ display: config, playlist: pet.map(item => item.id), playback: { width: 160, height: 128, fit: process.env.LEASE_ANIMATION_FIT || 'cover', zoom: Number(process.env.LEASE_ANIMATION_ZOOM || 1), order: 'sequential' } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
const report = { kind: 'real-browser-to-esp32-animation', visualConfirmed: false, config, media: pet.map(({ name }) => name), errors: [], samples: [] };
page.on('pageerror', error => report.errors.push(error.message));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
try {
  await page.goto(`${preview.url}/api/lease-voice/screen`);
  await page.waitForFunction(() => document.getElementById('notice').textContent.includes('素材库已读取'));
  await page.locator('#screen-push-start').click();
  await page.waitForFunction(() => document.getElementById('screen-push-status').textContent.includes('已接收'));
  console.log(JSON.stringify({ event: 'animation-started', media: report.media, config }));
  await page.screenshot({ path: join(artifacts, `m3-animation-${stamp}.png`) });
  const seconds = Number(process.env.LEASE_ANIMATION_SECONDS || 120);
  for (let elapsed = 0; elapsed < seconds; elapsed += 10) {
    await page.waitForTimeout(Math.min(10, seconds - elapsed) * 1000);
    const s = await observer.info();
    const sample = { received: s.received, drawn: s.drawn, dropped: s.dropped, displayError: s.displayError || null,
      status: await page.locator('#screen-push-status').textContent(), current: await page.locator('#screen-current').textContent() };
    report.samples.push(sample); console.log(JSON.stringify(sample));
    if (!s.streamId || !sample.status.startsWith('推送中')) throw new Error('Animation stream stopped unexpectedly');
  }
  report.result = 'stream-completed';
} finally {
  await page.locator('#screen-push-stop').click().catch(() => {});
  await preview.display.dispose(); await browser.close(); await preview.close();
  writeFileSync(join(artifacts, `m3-animation-${stamp}.json`), JSON.stringify(report, null, 2));
}
