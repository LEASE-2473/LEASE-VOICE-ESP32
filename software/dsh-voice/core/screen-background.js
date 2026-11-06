import { randomUUID } from 'node:crypto';
import { displayConfig } from '../extensions/display.js';
import { ScreenRenderer } from './screen-renderer.js';

export class BackgroundScreen {
  current = null;
  chain = Promise.resolve();
  status = { state: 'idle', frames: 0, name: '', error: '', lastFrameMs: 0 };
  constructor(media, display, { renderer = () => new ScreenRenderer(media) } = {}) {
    this.media = media; this.display = display; this.renderer = renderer;
  }
  view() { return { ...this.status }; }
  exclusive(fn) { const next = this.chain.then(fn); this.chain = next.catch(() => {}); return next; }
  async release() {
    const run = this.current; this.current = null;
    if (!run) return;
    run.cancelled = true; clearTimeout(run.timer);
    await Promise.allSettled([run.renderer.close(), run.stream ? this.display.stop(run.clientId, run.stream.streamId) : Promise.resolve()]);
  }
  start() {
    return this.exclusive(async () => {
      await this.release(); this.status.state = 'idle'; await this.media.ready;
      const library = this.media.view(), items = library.playlist.map(id => library.items.find(item => item.id === id));
      if (!items.length || items.some(item => !item)) throw new Error('请先保存包含可用素材的播放列表');
      const size = displayConfig(library.display);
      if (size.width !== library.playback.width || size.height !== library.playback.height) throw new Error('播放尺寸与设备屏幕配置不一致');
      const run = { clientId: `background-${randomUUID()}`, renderer: this.renderer(), cancelled: false };
      this.current = run;
      this.status = { state: 'starting', frames: 0, name: '', error: '', lastFrameMs: 0, startedAt: new Date().toISOString() };
      try {
        await run.renderer.open(items, library.playback);
        if (run.cancelled) { await this.release(); return this.view(); }
        run.stream = await this.display.start(run.clientId, library.display);
        if (run.cancelled) { await this.release(); return this.view(); }
        this.status.state = 'running';
        await this.tick(run);
        if (this.status.state === 'error') throw new Error(this.status.error);
        return this.view();
      } catch (error) {
        await this.release(); this.status.state = 'error'; this.status.error = error.message || '后台播放启动失败';
        throw new Error(this.status.error);
      }
    });
  }
  async tick(run) {
    if (this.current !== run || run.cancelled) return;
    const begin = performance.now();
    try {
      const frame = await run.renderer.frame();
      if (this.current !== run || run.cancelled) return;
      await this.display.frame(run.clientId, run.stream.streamId, this.status.frames + 1, frame.bytes);
      if (this.current !== run || run.cancelled) return;
      this.status.frames++; this.status.name = frame.name;
      this.status.lastFrameMs = Math.round(performance.now() - begin);
      run.timer = setTimeout(() => void this.tick(run), Math.max(0, 200 - (performance.now() - begin)));
      run.timer.unref?.();
    } catch (error) {
      if (this.current !== run || run.cancelled) return;
      this.status.state = 'error'; this.status.error = error.message || '后台画面推送失败';
      // 与新启动/停止串行清理，避免迟到错误关闭新播放器。
      void this.exclusive(async () => { if (this.current === run) await this.release(); });
    }
  }
  stop() {
    if (this.current) { this.current.cancelled = true; clearTimeout(this.current.timer); }
    return this.exclusive(async () => { await this.release(); this.status.state = 'idle'; this.status.error = ''; return this.view(); });
  }
  command(action) {
    if (action === 'start') return this.start();
    if (action === 'stop') return this.stop();
    return this.exclusive(async () => {
      if (!['pause', 'resume', 'next'].includes(action)) throw new Error('后台播放操作无效');
      if (!this.current || !['running', 'paused'].includes(this.status.state)) throw new Error('请先开始后台播放');
      await this.current.renderer.command(action);
      this.status.state = action === 'pause' ? 'paused' : 'running';
      return this.view();
    });
  }
  dispose() { return this.stop(); }
}
