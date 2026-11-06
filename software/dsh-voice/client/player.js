const PREFIX = '/api/lease-voice';
export async function api(path, body, signal) {
  const response = await fetch(`${PREFIX}/${path}`, { credentials: 'same-origin', signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `请求失败 ${response.status}`);
  return result;
}

export class VoicePlayer {
  // randomUUID 在 LAN 的普通 HTTP 页面上可能不可用；getRandomValues 仍可使用。
  clientId = globalThis.crypto?.randomUUID?.() || `browser-${Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('')}`;
  queue = [];
  current = null;
  audio = new Audio();
  status = '等待朗读';
  listeners = new Set();
  generation = 0;
  enabled = false;
  resume = null;
  constructor() { this.audio.preload = 'auto'; }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify(status) { this.status = status; for (const fn of this.listeners) fn(status); }
  async enable() {
    // 必须在按钮手势中调用。静音短 WAV 为当前播放器取得播放授权，不调用 provider。
    if (this.resume) {
      try { await this.audio.play(); this.resume?.(); this.resume = null; this.enabled = true; this.notify('播放中'); }
      catch { this.notify('请再次点击启用声音'); }
      return;
    }
    const wave = new Uint8Array(46);
    const view = new DataView(wave.buffer);
    const write = (at, text) => [...text].forEach((c, n) => { wave[at + n] = c.charCodeAt(0); });
    write(0, 'RIFF'); view.setUint32(4, 38, true); write(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, 2, true);
    const url = URL.createObjectURL(new Blob([wave], { type: 'audio/wav' }));
    this.audio.src = url;
    try { await this.audio.play(); this.enabled = true; this.notify('声音已启用'); }
    catch { this.notify('浏览器暂未允许播放，请再次点击'); }
    finally { URL.revokeObjectURL(url); }
  }
  enqueue(input) {
    if (this.queue.length >= 8) { this.notify('待播队列已满'); return; }
    const beforeSpeech = input.chime && input.automatic ? this.queue.findIndex(item => !item.chime) : -1;
    if (beforeSpeech >= 0) this.queue.splice(beforeSpeech, 0, input); else this.queue.push(input);
    if (!this.current) void this.pump();
  }
  async pump() {
    const input = this.queue.shift();
    if (!input) return;
    const generation = this.generation;
    const current = { input, controller: new AbortController(), id: null };
    this.current = current;
    try {
      this.notify(input.chime ? '准备完成提示…' : '合成中…');
      const started = await api('synthesize', { ...input, clientId: this.clientId, generation }, current.controller.signal);
      if (started.duplicate) { this.notify('本条已在其他窗口处理'); return; }
      current.id = started.id;
      let task = started;
      while (!['ready', 'completed', 'failed', 'canceled'].includes(task.state)) {
        await new Promise(resolve => setTimeout(resolve, 400));
        current.controller.signal.throwIfAborted();
        task = await api(`task?id=${started.id}&clientId=${this.clientId}`, undefined, current.controller.signal);
        this.notify(task.target === 'esp32' && ['sending', 'playing'].includes(task.state) ? `${task.state === 'sending' ? '发送到设备' : '设备播放中'} ${task.completed + 1}/${task.total || 1}` : `合成中 ${task.completed}/${task.total || 1}`);
      }
      if (task.state === 'failed') throw new Error(task.error);
      if (task.state === 'canceled' || generation !== this.generation) return;
      if (!input.chime) this.lastTask = { id: task.id, target: task.target };
      if (task.target === 'esp32') { this.notify('设备播放完成'); return; }
      for (const segment of task.segments) {
        current.controller.signal.throwIfAborted();
        const response = await fetch(`${PREFIX}/audio?id=${started.id}&clientId=${this.clientId}&segment=${segment}`, { signal: current.controller.signal });
        if (!response.ok) throw new Error('音频已过期，请重新生成');
        const url = URL.createObjectURL(await response.blob());
        try {
          current.controller.signal.throwIfAborted();
          this.audio.src = url;
          await new Promise((resolve, reject) => {
            const cleanup = () => { this.audio.onended = null; this.audio.onerror = null; current.controller.signal.removeEventListener('abort', abort); this.resume = null; };
            const finish = () => { cleanup(); resolve(); };
            const abort = () => { cleanup(); reject(new DOMException('停止', 'AbortError')); };
            this.audio.onended = finish;
            this.audio.onerror = () => { cleanup(); reject(new Error('音频无法播放，请检查提供商返回格式')); };
            current.controller.signal.addEventListener('abort', abort, { once: true });
            this.audio.play().then(() => { this.enabled = true; this.notify('播放中'); }).catch(error => {
              if (error.name === 'NotAllowedError') { this.resume = () => this.notify('播放中'); this.notify('需要点击「启用声音」才能播放'); }
              else { cleanup(); reject(new Error('音频无法播放，请检查格式')); }
            });
          });
        } finally { URL.revokeObjectURL(url); }
      }
      this.notify('播放完成');
    } catch (error) {
      if (generation === this.generation && error.name !== 'AbortError') this.notify(error.message || '朗读失败');
    } finally {
      if (this.current === current) { this.current = null; if (this.queue.length) void this.pump(); }
    }
  }
  stop(automaticOnly = false) {
    const matches = item => !automaticOnly || (item?.automatic && (automaticOnly === 'speech' ? !item.chime : automaticOnly === 'chime' ? item.chime : true));
    this.queue = this.queue.filter(item => !matches(item));
    if (automaticOnly && !matches(this.current?.input)) return;
    this.generation++;
    this.current?.controller.abort();
    this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.resume = null;
    void api('cancel', { clientId: this.clientId, generation: this.generation }).catch(() => {});
    this.notify('已停止');
  }
  dispose() { this.stop(); this.listeners.clear(); }
}
