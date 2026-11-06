import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// 私有无头浏览器只读取已入库素材；不连接DSH网页、不持有设备Token。
export class ScreenRenderer {
  constructor(media) { this.media = media; }
  async open(items, playback) {
    const executablePath = process.env.LEASE_VOICE_BROWSER_PATH || process.env.EDGE_PATH;
    this.browser = await chromium.launch({ headless: true, timeout: 15000,
      ...(executablePath ? { executablePath } : { channel: 'msedge' }),
      args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
    });
    const context = await this.browser.newContext({ viewport: { width: 640, height: 480 }, serviceWorkers: 'block' });
    const playerSource = await readFile(new URL('../client/screen-player.js', import.meta.url), 'utf8');
    await context.route('**/*', async route => {
      try {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://lease-voice-renderer.invalid') return await route.abort();
        if (url.pathname === '/') return await route.fulfill({ contentType: 'text/html', body: '<div><canvas id="canvas"></canvas></div><script type="module">import {ScreenPlayer} from "/screen-player.js"; window.player=new ScreenPlayer(document.getElementById("canvas"),(text,item)=>{window.statusView={text,name:item?.name||""}});</script>' });
        if (url.pathname === '/screen-player.js') return await route.fulfill({ contentType: 'text/javascript', body: playerSource });
        if (url.pathname === '/api/lease-voice/media-file' && /^[a-f0-9]{32}$/.test(url.searchParams.get('id') || '')) {
          const response = await this.media.response(url.searchParams.get('id'), route.request().headers().range);
          return await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
        }
        await route.abort();
      } catch { await route.abort().catch(() => {}); }
    });
    this.page = await context.newPage();
    await this.page.goto('http://lease-voice-renderer.invalid/');
    await this.page.waitForFunction(() => !!window.player);
    await this.page.evaluate(({ items, playback }) => { window.player.configure(items, playback); window.player.start(); }, { items, playback });
    await this.page.waitForFunction(() => window.player.media && (window.player.media.videoWidth || window.player.media.naturalWidth), null, { timeout: 15000 });
  }
  async frame() {
    const frame = await this.page.evaluate(() => {
      if (!window.player.running) throw new Error(window.statusView?.text || '后台播放已停止');
      const canvas = window.player.canvas, rgba = window.player.context.getImageData(0, 0, canvas.width, canvas.height).data;
      const bytes = new Uint8Array(canvas.width * canvas.height * 2);
      for (let src = 0, dst = 0; src < rgba.length; src += 4, dst += 2) {
        const rgb = ((rgba[src] >> 3) << 11) | ((rgba[src + 1] >> 2) << 5) | (rgba[src + 2] >> 3);
        bytes[dst] = rgb >> 8; bytes[dst + 1] = rgb & 255;
      }
      let binary = ''; for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
      return { bytes: btoa(binary), name: window.statusView?.name || '' };
    });
    return { bytes: Buffer.from(frame.bytes, 'base64'), name: frame.name };
  }
  async command(action) {
    await this.page.evaluate(action => {
      if (action === 'pause') window.player.pause();
      else if (action === 'resume') window.player.start();
      else if (action === 'next') window.player.next();
    }, action);
  }
  async close() { const browser = this.browser; this.browser = null; await browser?.close(); }
}
