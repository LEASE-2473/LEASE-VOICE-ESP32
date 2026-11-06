import { api } from './player.js';

export function rgb565be(rgba) {
  if (!rgba || rgba.length % 4) throw new Error('画面像素格式无效');
  const result = new Uint8Array(rgba.length / 2);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 2) {
    const color = ((rgba[i] >> 3) << 11) | ((rgba[i + 1] >> 2) << 5) | (rgba[i + 2] >> 3);
    result[j] = color >> 8; result[j + 1] = color & 255;
  }
  return result;
}
export class FrameSender {
  constructor(canvas, clientId, report) { this.canvas = canvas; this.clientId = clientId; this.report = report; this.generation = 0; }
  async start(config) {
    await this.stop(); const generation = ++this.generation;
    this.report('正在检查固件并配置屏幕…');
    const started = await api('screen-control', { action: 'start', clientId: this.clientId, config });
    if (generation !== this.generation) { await api('screen-control', { action: 'stop', clientId: this.clientId, streamId: started.streamId }); return; }
    this.stream = started; this.sequence = 0;
    const tick = async () => {
      if (generation !== this.generation) return;
      const begin = performance.now();
      try {
        if (this.canvas.width !== started.width || this.canvas.height !== started.height) throw new Error('预览尺寸已改变，请停止后按新尺寸重新推送');
        const rgba = this.canvas.getContext('2d').getImageData(0, 0, started.width, started.height).data;
        const response = await fetch('/api/lease-voice/screen-frame', {
          method: 'POST', credentials: 'same-origin', signal: this.controller.signal,
          headers: { 'Content-Type': 'application/octet-stream', 'X-Lease-Client-Id': this.clientId, 'X-Lease-Stream-Id': started.streamId, 'X-Lease-Sequence': String(++this.sequence) }, body: rgb565be(rgba),
        });
        const ack = await response.json(); if (!response.ok) throw new Error(ack.error || '画面推送失败');
        if (generation !== this.generation) return;
        this.report(`推送中 · 已接收 ${this.sequence} 帧 · 上一帧 ${Math.round(performance.now() - begin)}ms（设备接收确认）`);
        this.timer = setTimeout(tick, Math.max(0, 200 - (performance.now() - begin)));
      } catch (e) {
        if (generation !== this.generation) return;
        await this.stop(); this.report(e.message || '画面推送失败');
      }
    };
    this.controller = new AbortController(); void tick();
  }
  async stop() {
    this.generation++; clearTimeout(this.timer); this.controller?.abort();
    const old = this.stream; this.stream = null;
    if (old) await api('screen-control', { action: 'stop', clientId: this.clientId, streamId: old.streamId }).catch(() => {});
  }
  pagehide() {
    this.generation++; clearTimeout(this.timer); this.controller?.abort();
    if (this.stream) void fetch('/api/lease-voice/screen-control', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop', clientId: this.clientId, streamId: this.stream.streamId }) }).catch(() => {});
    this.stream = null;
  }
}
