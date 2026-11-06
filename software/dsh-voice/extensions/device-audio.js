import { endpointUrl, readLimited } from '../providers/tts.js';

const MAX_PCM = 4 * 1024 * 1024;
function root(device) {
  if (!device?.endpoint) throw new Error('请先在语音扩展中保存设备地址和 Token');
  return endpointUrl(device.endpoint).replace(/\/$/, '');
}
async function request(device, path, { method = 'GET', body, signal, headers = {} } = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${root(device)}/lease-voice/v1/${path}`, {
    method, headers: { ...(device.token ? { Authorization: `Bearer ${device.token}` } : {}), ...headers },
    redirect: 'error', signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(15000)]), ...(body === undefined ? {} : { body }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 409) throw new Error('设备正在播放其他任务，请停止后重试');
    throw new Error(`设备请求失败（HTTP ${response.status}）`);
  }
  let data;
  try { data = JSON.parse((await readLimited(response, 32768)).toString('utf8')); }
  catch { throw new Error('设备返回了无效的播放状态'); }
  if (data.protocol !== 1) throw new Error('设备播放协议不匹配');
  return data;
}
export async function stopDeviceAudio(device, id, fetchImpl = fetch) {
  return request(device, 'command', { method: 'POST', body: JSON.stringify({ protocol: 1, action: 'stop', id }), headers: { 'Content-Type': 'application/json' } }, fetchImpl);
}
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export async function playDeviceAudio(device, audio, { id, signal, onState, pollMs = 300, fetchImpl = fetch } = {}) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id || '')) throw new Error('设备播放任务身份无效');
  if (audio.format !== 'pcm_s16le' || audio.channels !== 1 || audio.sampleRate !== 24000 ||
      !audio.bytes?.length || audio.bytes.length % 2 || audio.bytes.length > MAX_PCM) {
    throw new Error('音频须为 24kHz 单声道 PCM16，且每段不超过 4MiB');
  }
  signal?.throwIfAborted();
  const info = await request(device, 'info', { signal }, fetchImpl);
  if (info.kind !== 'lease-voice-esp32' || !info.capabilities?.includes('audio-pcm16') || !info.capabilities?.includes('playback-status')) {
    throw new Error('设备固件不支持语音播放，请升级到 M2 固件');
  }
  let cancellation;
  const stop = () => { cancellation ||= stopDeviceAudio(device, id, fetchImpl).catch(() => {}); };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    signal?.throwIfAborted();
    onState?.('sending');
    const accepted = await request(device, 'audio', {
      method: 'POST', signal, body: audio.bytes,
      headers: { 'Content-Type': 'application/octet-stream', 'X-Lease-Audio-Id': id, 'X-Lease-Sample-Rate': '24000' },
    }, fetchImpl);
    if (accepted.ok !== true || accepted.id !== id || !['queued', 'playing'].includes(accepted.state)) throw new Error('设备未接受本次音频');
    onState?.('playing');
    const deadline = Date.now() + Math.ceil(audio.bytes.length / 48) + 20000;
    while (Date.now() < deadline) {
      await delay(pollMs, signal);
      const status = await request(device, 'playback', { signal }, fetchImpl);
      if (status.id !== id) throw new Error('设备播放任务已被替换');
      if (status.state === 'completed') return;
      if (status.state === 'stopped') throw new Error('设备播放已停止');
      if (status.state === 'error') throw new Error('设备音频播放失败，请检查固件日志');
      if (!['queued', 'playing'].includes(status.state)) throw new Error('设备返回了无效的播放状态');
    }
    throw new Error('设备播放超时');
  } catch (error) {
    stop(); await cancellation;
    throw error;
  } finally { signal?.removeEventListener('abort', stop); }
}
