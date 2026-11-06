import { endpointUrl, readLimited } from '../providers/tts.js';

// 调试协议 v1；固件实现前不将健康检查或模拟结果描述为实物兼容。
export async function debugDevice(device, action, value, fetchImpl = fetch) {
  if (!device.endpoint) throw new Error('请先保存设备地址');
  const root = endpointUrl(device.endpoint).replace(/\/$/, '');
  const allowed = ['info', 'test-tone', 'stop', 'volume'];
  if (!allowed.includes(action)) throw new Error('不支持的设备操作');
  if (action === 'volume' && (!Number.isInteger(value) || value < 0 || value > 100)) throw new Error('音量须为 0–100 的整数');
  const headers = { 'Content-Type': 'application/json' };
  if (device.token) headers.Authorization = `Bearer ${device.token}`;
  let response;
  try {
    response = await fetchImpl(`${root}/lease-voice/v1/${action === 'info' ? 'info' : 'command'}`, { method: action === 'info' ? 'GET' : 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(5000), ...(action === 'info' ? {} : { body: JSON.stringify({ protocol: 1, action, ...(action === 'volume' ? { value } : {}) }) }) });
  } catch { throw new Error('设备连接失败或超时，请检查 Wi-Fi、地址和固件'); }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`设备请求失败（HTTP ${response.status}）`); }
  let data;
  try { data = JSON.parse((await readLimited(response, 32768)).toString('utf8')); } catch { throw new Error('设备没有返回有效的调试协议 JSON'); }
  if (data.protocol !== 1 || (action === 'info' ? data.kind !== 'lease-voice-esp32' : data.ok !== true)) throw new Error('设备协议不匹配或操作未被接受');
  return action === 'info' ? { online: true, protocol: 1, name: String(data.name || '').slice(0, 100), firmware: String(data.firmware || '').slice(0, 100), capabilities: Array.isArray(data.capabilities) ? data.capabilities.filter(s => typeof s === 'string').slice(0, 12) : [] } : { ok: true, protocol: 1, action };
}
