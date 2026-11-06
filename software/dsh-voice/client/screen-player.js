// 输出边界：本版只在 canvas 预览；后续设备输出复用同一播放选择逻辑。
export class ScreenPlayer {
  constructor(canvas, report) {
    this.canvas = canvas; this.context = canvas.getContext('2d'); this.report = report;
    this.running = false; this.paused = false; this.generation = 0;
    this.items = []; this.options = {}; this.position = -1;
  }
  configure(items, options) {
    this.stop(); this.items = items; this.options = options;
    this.canvas.width = options.width; this.canvas.height = options.height;
    this.clear();
  }
  clear() {
    this.context.fillStyle = this.options.background || '#10151d';
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
  start() {
    if (!this.items.length) { this.report('请先添加可用素材', null); return; }
    if (this.running && this.paused) {
      this.paused = false; this.lastTick = performance.now();
      this.report('预览播放中', this.items[this.position]);
      const generation = this.generation;
      if (this.media?.tagName === 'VIDEO') void this.media.play().catch(() => { if (generation === this.generation) this.fail('视频无法继续，请重新开始'); });
      return;
    }
    this.running = true; this.paused = false; this.position = -1; this.next();
  }
  pause() {
    if (!this.running) return;
    this.paused = true; this.media?.pause?.();
    this.report('预览已暂停', this.items[this.position]);
  }
  cleanup() {
    cancelAnimationFrame(this.raf); clearTimeout(this.loadTimer);
    if (this.media) {
      this.media.onload = this.media.onerror = this.media.onloadeddata = this.media.onended = null;
      this.media.pause?.(); this.media.removeAttribute('src'); this.media.load?.(); this.media.remove(); this.media = null;
    }
  }
  stop() {
    this.generation++; this.running = false; this.paused = false; this.cleanup(); this.clear();
    this.report('预览已停止', null);
  }
  fail(message) {
    this.running = false; this.cleanup(); this.report(message, this.items[this.position]);
  }
  next() {
    if (!this.items.length) { this.report('请先添加可用素材', null); return; }
    this.cleanup(); const generation = ++this.generation;
    const old = this.position;
    this.position = this.options.order === 'random' && this.items.length > 1
      ? (old < 0 ? Math.floor(Math.random() * this.items.length) : (old + 1 + Math.floor(Math.random() * (this.items.length - 1))) % this.items.length)
      : (old + 1) % this.items.length;
    this.running = true; this.paused = false; this.elapsed = 0;
    const item = this.items[this.position];
    this.report('正在载入画面…', item);
    const media = document.createElement(item.kind === 'video' ? 'video' : 'img');
    this.media = media;
    this.loadTimer = setTimeout(() => { if (this.generation === generation) this.fail('素材载入超时，请尝试下一个'); }, 15000);
    const loaded = () => {
      if (generation !== this.generation) return;
      clearTimeout(this.loadTimer); this.report(this.paused ? '预览已暂停' : '预览播放中', item);
      this.lastTick = performance.now(); this.lastDraw = 0;
      const frame = now => {
        if (generation !== this.generation || !this.running) return;
        const delta = Math.min(now - this.lastTick, 250); this.lastTick = now;
        if (!this.paused) {
          this.elapsed += delta;
          if (now - this.lastDraw >= 1000 / 12) { this.draw(media); this.lastDraw = now; }
          if (item.kind === 'image' && this.elapsed >= this.options.seconds * 1000) { this.next(); return; }
        }
        this.raf = requestAnimationFrame(frame);
      };
      this.draw(media); this.raf = requestAnimationFrame(frame);
    };
    media.onerror = () => { if (generation === this.generation) this.fail('素材无法解码，请尝试其他文件或下一个'); };
    if (item.kind === 'video') {
      media.muted = true; media.playsInline = true; media.preload = 'auto';
      media.onloadeddata = () => { loaded(); if (!this.paused) void media.play().catch(() => { if (generation === this.generation) this.fail('视频无法播放，请检查编码'); }); };
      media.onended = () => { if (generation === this.generation && !this.paused) this.next(); };
    } else media.onload = loaded;
    media.hidden = true; this.canvas.parentElement.append(media);
    media.src = `/api/lease-voice/media-file?id=${encodeURIComponent(item.id)}`;
  }
  draw(media) {
    const w = media.videoWidth || media.naturalWidth, h = media.videoHeight || media.naturalHeight;
    if (!w || !h) return;
    const scale = Math[this.options.fit === 'cover' ? 'max' : 'min'](this.canvas.width / w, this.canvas.height / h) * (this.options.zoom ?? 1);
    this.clear();
    this.context.drawImage(media, (this.canvas.width - w * scale) / 2, (this.canvas.height - h * scale) / 2, w * scale, h * scale);
  }
}
