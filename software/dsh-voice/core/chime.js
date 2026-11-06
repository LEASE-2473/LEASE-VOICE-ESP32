// 本地生成短提示音，不调用 TTS；浏览器与设备共用同一份 PCM。
export function chimeAudio(target = 'browser', volume = 35) {
  const rate = 24000, count = Math.round(rate * 0.38);
  const pcm = Buffer.alloc(count * 2);
  for (let n = 0; n < count; n++) {
    const t = n / rate;
    const envelope = Math.min(1, t / 0.008) * Math.exp(-t * 11) * Math.min(1, (count - n) / 240);
    const tone = Math.sin(2 * Math.PI * 1320 * t) + 0.25 * Math.sin(2 * Math.PI * 2640 * t);
    pcm.writeInt16LE(Math.round(tone * envelope * 7000 * volume / 100), n * 2);
  }
  if (target === 'esp32') return { bytes: pcm, mime: 'audio/pcm', sampleRate: rate, channels: 1, format: 'pcm_s16le' };
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return { bytes: Buffer.concat([header, pcm]), mime: 'audio/wav' };
}
