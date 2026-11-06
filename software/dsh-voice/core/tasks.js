import { randomUUID, createHash } from 'node:crypto';
import { speechText, splitText } from './text.js';
import { synthesize } from '../providers/tts.js';
import { playDeviceAudio } from '../extensions/device-audio.js';
import { chimeAudio } from './chime.js';

export class TaskService {
  jobs = new Map();
  claims = new Map();
  leases = new Map();
  generations = new Map();
  constructor(store, synth = synthesize, { play = playDeviceAudio, sounds } = {}) { this.store = store; this.synth = synth; this.playDevice = play; this.sounds = sounds; }
  lease(sessionId, clientId, release = false) {
    const old = this.leases.get(sessionId);
    if (release) { if (old?.clientId === clientId) this.leases.delete(sessionId); return false; }
    if (old && old.until > Date.now() && old.clientId !== clientId) return false;
    this.leases.set(sessionId, { clientId, until: Date.now() + 8000 });
    return true;
  }
  start({ text, clientId, autoKey, sessionId, generation = 0, chime = false, clipId }) {
    this.cleanup();
    if (!Number.isSafeInteger(generation) || generation < 0 || generation < (this.generations.get(clientId)?.value || 0)) throw new Error('语音任务已被停止');
    this.generations.set(clientId, { value: generation, at: Date.now() });
    const config = this.store.get();
    if (autoKey) {
      const lease = this.leases.get(sessionId);
      if ((chime ? !config.completion?.enabled : config.mode !== 'auto') || lease?.clientId !== clientId || lease.until <= Date.now()) throw new Error('当前窗口没有自动播放资格');
      if (this.claims.has(autoKey)) return { duplicate: true };
    }
    text = chime ? '完成提示音' : speechText(text);
    if (!text) throw new Error('没有可朗读文本');
    if (Array.from(text).length > 24000) throw new Error('本次文本超过 24000 字，请分次朗读');
    const target = (chime ? config.completion?.target : config.outputTarget) || 'browser';
    if (target === 'esp32' && !config.device?.endpoint) throw new Error('请先在语音扩展中保存设备地址和 Token');
    if (target === 'esp32' && [...this.jobs.values()].some(j => j.target === 'esp32' && ['queued', 'synthesizing', 'sending', 'playing'].includes(j.state))) throw new Error('设备正在播放其他任务，请停止后重试');
    const soundMode = config.completion?.sound || 'ding';
    if (chime && !clipId && soundMode !== 'ding') {
      if (!this.sounds) throw new Error('音频素材库尚未加载');
      clipId = this.sounds.pick(config.completion?.clipIds, soundMode);
    }
    if (chime && clipId && !this.sounds) throw new Error('音频素材库尚未加载');
    const provider = chime ? { chime: true, clipId, volume: config.completion?.volume ?? 35 } : { ...config.providers[config.activeProvider], ...(target === 'esp32' ? { audioFormat: 'pcm', sampleRate: 24000 } : {}) };
    const cacheKey = createHash('sha256').update(JSON.stringify([provider, text, target, target === 'esp32' ? config.device : null])).digest('hex');
    const cached = [...this.jobs.values()].find(job => job.clientId === clientId && job.cacheKey === cacheKey && ['ready', 'completed'].includes(job.state));
    if (cached && target === 'browser') { if (autoKey) this.claims.set(autoKey, Date.now()); return this.view(cached); }
    if ([...this.jobs.values()].filter(j => ['queued', 'synthesizing', 'sending', 'playing'].includes(j.state)).length >= 4 || this.jobs.size >= 40) throw new Error('语音任务繁忙，请停止或清理后重试');
    const job = { id: randomUUID(), clientId, cacheKey, generation, target, device: target === 'esp32' ? structuredClone(config.device) : undefined, auto: !!autoKey, state: 'queued', createdAt: Date.now(), segments: [], completed: 0, total: 0, controller: new AbortController(), error: '' };
    this.jobs.set(job.id, job);
    if (autoKey) this.claims.set(autoKey, Date.now());
    void this.run(job, provider, text, cached?.segments);
    return this.view(job);
  }
  async run(job, provider, text, cachedSegments) {
    try {
      job.state = 'synthesizing';
      const parts = splitText(text, job.target === 'esp32' ? 200 : 800);
      job.total = parts.length;
      for (const [index, part] of parts.entries()) {
        job.state = 'synthesizing';
        job.controller.signal.throwIfAborted();
        const audio = cachedSegments?.[index] || (provider.chime ? provider.clipId ? await this.sounds.audio(provider.clipId, job.target, provider.volume) : chimeAudio(job.target, provider.volume) : await this.synth(provider, part, job.controller.signal));
        job.controller.signal.throwIfAborted();
        const used = [...this.jobs.values()].reduce((sum, j) => sum + j.segments.reduce((n, s) => n + s.bytes.length, 0), 0);
        if (used + audio.bytes.length > 64 * 1024 * 1024) throw new Error('音频缓存已满，请清理后重试');
        job.segments.push(audio);
        if (job.target === 'esp32') {
          await this.playDevice(job.device, audio, { id: `${job.id}-${index}`, signal: job.controller.signal, onState: state => { job.state = state; } });
          job.controller.signal.throwIfAborted();
        }
        job.completed++;
      }
      job.state = job.target === 'esp32' ? 'completed' : 'ready';
    } catch (error) {
      job.state = job.controller.signal.aborted ? 'canceled' : 'failed';
      // 不把网络库原始错误或供应商响应正文回传，避免密钥/聊天原文泄露。
      job.error = job.state === 'canceled' ? '' : /^(请|没有|本次|语音|音频|设备|提供商|TTS|火山|MiniMax|Speech)/.test(error.message) ? error.message : '合成连接失败或超时，请检查服务地址与网络';
      job.segments = [];
    }
  }
  get(id, clientId) {
    const job = this.jobs.get(id);
    if (!job || job.clientId !== clientId) throw new Error('语音任务不存在或已过期');
    return job;
  }
  view(job) { return { id: job.id, target: job.target || 'browser', state: job.state, completed: job.completed, total: job.total, segments: job.segments.map((_, index) => index), error: job.error }; }
  cancel(clientId, id, generation) {
    if (Number.isSafeInteger(generation) && generation >= 0) this.generations.set(clientId, { value: Math.max(generation, this.generations.get(clientId)?.value || 0), at: Date.now() });
    for (const job of this.jobs.values()) if (job.clientId === clientId && (!id || job.id === id) && (!Number.isSafeInteger(generation) || job.generation < generation)) {
      job.controller.abort(); job.state = 'canceled'; job.segments = []; this.jobs.delete(job.id);
    }
  }
  cancelAutomatic() { for (const job of this.jobs.values()) if (job.auto) this.cancel(job.clientId, job.id); this.leases.clear(); }
  cleanup() {
    for (const [id, job] of this.jobs) if (Date.now() - job.createdAt > 15 * 60000) { job.controller.abort(); this.jobs.delete(id); }
    for (const [key, at] of this.claims) if (Date.now() - at > 24 * 3600000) this.claims.delete(key);
    while (this.claims.size > 4096) this.claims.delete(this.claims.keys().next().value);
    for (const [id, lease] of this.leases) if (lease.until <= Date.now()) this.leases.delete(id);
    for (const [id, generation] of this.generations) if (Date.now() - generation.at > 3600000) this.generations.delete(id);
    while (this.generations.size > 4096) this.generations.delete(this.generations.keys().next().value);
  }
  dispose() { for (const job of this.jobs.values()) job.controller.abort(); this.jobs.clear(); this.leases.clear(); }
}
