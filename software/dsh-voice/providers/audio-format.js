// Hardware output is deliberately explicit: browser calls continue to use MP3.
export function outputFormat(config) {
  const format = config.audioFormat ?? 'mp3';
  if (!['mp3', 'pcm'].includes(format)) throw new Error('提供商音频格式须为 mp3 或 pcm');
  if (format === 'pcm' && config.sampleRate !== undefined && config.sampleRate !== 24000) {
    throw new Error('提供商设备音频当前仅支持 24000Hz PCM');
  }
  return { format, sampleRate: format === 'pcm' ? 24000 : undefined };
}

export function audioResult(bytes, output = { format: 'mp3' }) {
  if (!bytes.length) throw new Error('提供商返回了空音频');
  if (output.format !== 'pcm') return { bytes, mime: 'audio/mpeg' };
  if (bytes.length % 2) throw new Error('提供商 PCM 音频不是完整的 16 位采样');
  // These are container signatures, not raw PCM. Do not play an ignored format
  // request as loud digital noise on the device. Metadata checks add protection
  // where the provider supplies it; raw PCM has no self-describing header.
  const prefix = bytes.subarray(0, 4).toString('ascii');
  if (['RIFF', 'OggS', 'fLaC'].includes(prefix) || bytes.subarray(0, 3).toString('ascii') === 'ID3') {
    throw new Error('提供商未返回原始 PCM 音频，请核对接口格式支持');
  }
  return { bytes, mime: 'audio/pcm', sampleRate: 24000, channels: 1, format: 'pcm_s16le' };
}
