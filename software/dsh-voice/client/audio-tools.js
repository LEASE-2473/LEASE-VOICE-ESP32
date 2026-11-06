import { api } from './player.js';

export async function normalizeAudio(blobs, maxSeconds = 60) {
  if (!blobs.length) throw new Error('没有可保存的音频');
  const context = new OfflineAudioContext(1, 1, 24000);
  const parts = []; let length = 0;
  for (const blob of blobs) {
    let decoded;
    try { decoded = await context.decodeAudioData(await blob.arrayBuffer()); }
    catch { throw new Error('音频无法解码，请使用完整的 MP3 或 WAV 文件'); }
    length += decoded.length;
    if (!decoded.length || length > 24000 * maxSeconds) throw new Error(`音频最长${maxSeconds}秒，请缩短后重试`);
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const values = decoded.getChannelData(channel);
      for (let n = 0; n < values.length; n++) mono[n] += values[n] / decoded.numberOfChannels;
    }
    parts.push(mono);
  }
  const bytes = new Uint8Array(44 + length * 2), view = new DataView(bytes.buffer);
  const text = (at, value) => [...value].forEach((letter, i) => { bytes[at + i] = letter.charCodeAt(0); });
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 24000, true); view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, length * 2, true);
  let at = 44;
  for (const part of parts) for (const value of part) { view.setInt16(at, Math.round(Math.max(-1, Math.min(1, value)) * 32767), true); at += 2; }
  return new Blob([bytes], { type: 'audio/wav' });
}
export async function importSound(name, wav) {
  const response = await fetch('/api/lease-voice/sound-import', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'audio/wav', 'X-Lease-Filename': encodeURIComponent(name) }, body: wav });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '音频素材保存失败'); return result;
}
export async function taskWav(player, maxSeconds = 600) {
  const task = player.lastTask;
  if (!task) throw new Error('请先完成一次合成，再保存音频');
  const view = await api(`task?id=${task.id}&clientId=${player.clientId}`);
  if (!['ready', 'completed'].includes(view.state)) throw new Error('音频尚未合成完成或已过期');
  const blobs = [];
  for (const segment of view.segments) {
    const response = await fetch(`/api/lease-voice/audio?id=${task.id}&clientId=${player.clientId}&segment=${segment}`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('音频缓存已过期，请重新合成');
    blobs.push(await response.blob());
  }
  return normalizeAudio(blobs, maxSeconds);
}
export function downloadWav(wav, name) {
  const url = URL.createObjectURL(wav), link = document.createElement('a');
  link.href = url; link.download = `${(name || '合成语音').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120)}.wav`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
