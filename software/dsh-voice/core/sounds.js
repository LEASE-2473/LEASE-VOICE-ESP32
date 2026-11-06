import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID, randomInt } from 'node:crypto';

export const MAX_SOUND_SECONDS = 60;
export const MAX_SOUND_BYTES = 44 + 24000 * 2 * MAX_SOUND_SECONDS;
export function wavFromPcm(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
export function readSoundWav(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 46 || bytes.length > MAX_SOUND_BYTES || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('音频须为完整 WAV，提示素材最长60秒');
  let pcm, format;
  for (let at = 12; at + 8 <= bytes.length;) {
    const type = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4), start = at + 8;
    if (start + size > bytes.length) throw new Error('音频 WAV 数据被截断');
    if (type === 'fmt ') {
      if (format || size < 16) throw new Error('音频 WAV 格式无效');
      format = [bytes.readUInt16LE(start), bytes.readUInt16LE(start + 2), bytes.readUInt32LE(start + 4), bytes.readUInt32LE(start + 8), bytes.readUInt16LE(start + 12), bytes.readUInt16LE(start + 14)];
    }
    if (type === 'data') { if (pcm) throw new Error('音频 WAV 数据重复'); pcm = bytes.subarray(start, start + size); }
    at = start + size + (size & 1);
  }
  if (!format || format.join(',') !== '1,1,24000,48000,2,16' || !pcm?.length || pcm.length % 2) throw new Error('音频须为24kHz、16位、单声道PCM WAV，请先在电脑转换');
  return pcm;
}

export class SoundLibrary {
  items = [];
  chain = Promise.resolve();
  lastPicked = '';
  constructor(directory) { this.directory = directory; this.ready = this.load(); }
  async load() {
    await mkdir(join(this.directory, 'sounds'), { recursive: true });
    try {
      const data = JSON.parse(await readFile(join(this.directory, 'sounds.json'), 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.items) || data.items.some(item => !/^[a-f0-9]{64}$/.test(item.id))) throw new Error('音频素材库格式无效');
      this.items = data.items;
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  view() { return { items: structuredClone(this.items), maxSeconds: MAX_SOUND_SECONDS, maxBytes: MAX_SOUND_BYTES }; }
  async persist(items) {
    const file = join(this.directory, 'sounds.json'), temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify({ version: 1, items }, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, file); this.items = items;
  }
  change(fn) { const next = this.chain.then(async () => { await this.ready; return fn(); }); this.chain = next.catch(() => {}); return next; }
  async import(name, bytes) {
    return this.change(async () => {
      if (typeof name !== 'string' || !name.trim() || name.length > 160 || /[\0\r\n/\\]/.test(name)) throw new Error('音频素材名称无效');
      const pcm = readSoundWav(bytes), id = createHash('sha256').update(pcm).digest('hex');
      const existing = this.items.find(item => item.id === id);
      if (existing) return { item: structuredClone(existing), duplicate: true, ...this.view() };
      if (this.items.length >= 200 || this.items.reduce((sum, x) => sum + x.bytes, 0) + bytes.length > 64 * 1024 * 1024) throw new Error('音频素材库已满（200项/64MiB）');
      const normalized = wavFromPcm(pcm), file = join(this.directory, 'sounds', `${id}.wav`);
      let peak = 0;
      for (let n = 0; n < pcm.length; n += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(n)));
      const item = { id, name: name.trim().replace(/\.(wav|mp3)$/i, ''), bytes: normalized.length, seconds: pcm.length / 48000, peak: Number((peak / 32768).toFixed(4)), createdAt: new Date().toISOString() };
      await writeFile(file, normalized, { flag: 'wx', mode: 0o600 });
      try { await this.persist([...this.items, item]); } catch (e) { await unlink(file).catch(() => {}); throw e; }
      return { item, ...this.view() };
    });
  }
  pick(ids, mode = 'random') {
    const available = [...new Set(ids || [])].filter(id => this.items.some(item => item.id === id));
    if (!available.length) throw new Error('请先选择可用的完成提示语音素材');
    const pool = mode === 'selected' ? available.slice(0, 1) : available.filter(id => available.length === 1 || id !== this.lastPicked);
    this.lastPicked = pool[randomInt(pool.length)]; return this.lastPicked;
  }
  async audio(id, target = 'browser', volume = 100) {
    await this.ready;
    if (!this.items.some(item => item.id === id) || !/^[a-f0-9]{64}$/.test(id)) throw new Error('音频素材不存在或已删除');
    const file = join(this.directory, 'sounds', `${id}.wav`);
    if ((await stat(file)).size > MAX_SOUND_BYTES) throw new Error('音频提示素材最长60秒');
    let pcm = readSoundWav(await readFile(file));
    if (!Number.isInteger(volume) || volume < 0 || volume > 100) throw new Error('音频素材音量无效');
    if (volume !== 100) {
      const scaled = Buffer.alloc(pcm.length);
      for (let at = 0; at < pcm.length; at += 2) scaled.writeInt16LE(Math.round(pcm.readInt16LE(at) * volume / 100), at);
      pcm = scaled;
    }
    return target === 'esp32' ? { bytes: pcm, mime: 'audio/pcm', sampleRate: 24000, channels: 1, format: 'pcm_s16le' } : { bytes: wavFromPcm(pcm), mime: 'audio/wav' };
  }
  async remove(id) {
    return this.change(async () => {
      if (!this.items.some(item => item.id === id)) throw new Error('音频素材不存在');
      await this.persist(this.items.filter(item => item.id !== id));
      await unlink(join(this.directory, 'sounds', `${id}.wav`)).catch(e => { if (e.code !== 'ENOENT') throw e; });
      return this.view();
    });
  }
}
