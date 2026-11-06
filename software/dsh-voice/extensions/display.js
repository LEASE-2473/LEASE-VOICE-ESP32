import { randomUUID } from 'node:crypto';
import { endpointUrl, readLimited } from '../providers/tts.js';

export const MAX_FRAME_BYTES = 240 * 320 * 2;
export function displayConfig(input = {}) {
  const defaults = { profile: 'st7735-128x160', xGap: 0, yGap: 0, swapXY: false, mirrorX: false, mirrorY: false, bgr: false, invert: false };
  const out = { ...defaults };
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !Object.hasOwn(defaults, key))) throw new Error('设备屏幕配置无效');
  Object.assign(out, input);
  const sizes = { 'st7735-128x160': [128, 160, 132, 162], 'st7789-240x240': [240, 240, 240, 320], 'st7789-240x320': [240, 320, 240, 320] };
  if (!Object.hasOwn(sizes, out.profile)) throw new Error('设备屏幕型号无效');
  for (const key of ['swapXY', 'mirrorX', 'mirrorY', 'bgr', 'invert']) if (typeof out[key] !== 'boolean') throw new Error('设备屏幕开关配置无效');
  let [width, height, ramWidth, ramHeight] = sizes[out.profile];
  if (out.swapXY) [width, height, ramWidth, ramHeight] = [height, width, ramHeight, ramWidth];
  if (!Number.isInteger(out.xGap) || !Number.isInteger(out.yGap) || out.xGap < 0 || out.yGap < 0 || out.xGap > ramWidth - width || out.yGap > ramHeight - height || out.xGap > 80 || out.yGap > 80) throw new Error('设备屏幕偏移超出控制器范围');
  return { config: out, width, height };
}
const identity = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
export class DisplayService {
  current = null;
  control = Promise.resolve();
  constructor(store, fetchImpl = fetch) { this.store = store; this.fetch = fetchImpl; }
  async request(device, path, { body, bytes, headers = {}, signal } = {}) {
    if (!device?.endpoint) throw new Error('请先在语音扩展保存设备地址和 Token');
    const root = endpointUrl(device.endpoint).replace(/\/$/, '');
    let response;
    try {
      response = await this.fetch(`${root}/lease-voice/v1/${path}`, {
        method: body === undefined && bytes === undefined ? 'GET' : 'POST', redirect: 'error',
        signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(5000)]),
        headers: { ...(device.token ? { Authorization: `Bearer ${device.token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        ...(bytes === undefined ? body === undefined ? {} : { body: JSON.stringify(body) } : { body: bytes }),
      });
    } catch { throw new Error('设备屏幕连接失败或超时'); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`设备屏幕请求失败（HTTP ${response.status}）`); }
    let data;
    try { data = JSON.parse((await readLimited(response, 32768)).toString('utf8')); } catch { throw new Error('设备屏幕状态格式无效'); }
    if (data.protocol !== 1 || data.ok === false) throw new Error('设备屏幕协议不匹配');
    return data;
  }
  async info() {
    const device = this.store.get().device;
    const info = await this.request(device, 'info');
    if (info.kind !== 'lease-voice-esp32' || !info.capabilities?.includes('display-rgb565') || !info.capabilities?.includes('display-config')) throw new Error('设备固件尚不支持屏幕接收，需要 M3 固件');
    return this.request(device, 'display');
  }
  exclusive(fn) {
    const next = this.control.then(fn); this.control = next.catch(() => {}); return next;
  }
  async start(clientId, input) {
    return this.exclusive(async () => {
      if (!identity(clientId)) throw new Error('请求客户端身份无效');
      const selected = displayConfig(input);
      if (this.current) {
        if (Date.now() - this.current.lastAt < 10000) throw new Error('设备屏幕已被一个窗口占用，请先停止推送');
        await this.closeCurrent();
      }
      const device = this.store.get().device;
      await this.info();
      const configured = await this.request(device, 'display', { body: { protocol: 1, action: 'configure', ...selected.config } });
      if (!configured.ready || configured.width !== selected.width || configured.height !== selected.height || configured.format !== 'rgb565be') throw new Error('设备屏幕初始化失败或尺寸不匹配，请检查配置');
      const streamId = randomUUID();
      const started = await this.request(device, 'display', { body: { protocol: 1, action: 'start', streamId } });
      if (started.streamId !== streamId || !started.ready) throw new Error('设备未接受屏幕播放流');
      this.current = { clientId, streamId, ...selected, device: structuredClone(device), sequence: 0, inFlight: false, lastAt: Date.now(), controller: new AbortController() };
      return { streamId, width: selected.width, height: selected.height, format: 'rgb565be', fps: 5, state: 'started' };
    });
  }
  async frame(clientId, streamId, sequence, bytes) {
    const active = this.current;
    if (!active || active.streamId !== streamId || active.clientId !== clientId) throw new Error('设备屏幕播放流已失效，请重新开始');
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 0xffffffff || sequence <= active.sequence) throw new Error('设备画面序号无效或已经发送');
    if (bytes.length !== active.width * active.height * 2 || bytes.length > MAX_FRAME_BYTES) throw new Error('设备画面长度与配置尺寸不一致');
    if (active.inFlight) throw new Error('设备画面正在传输，请等待上一帧完成');
    active.inFlight = true;
    try {
      const ack = await this.request(active.device, 'frame', { bytes, signal: active.controller.signal, headers: {
        'Content-Type': 'application/octet-stream', 'X-Lease-Stream-Id': streamId, 'X-Lease-Sequence': String(sequence),
        'X-Lease-Width': String(active.width), 'X-Lease-Height': String(active.height),
      } });
      if (ack.streamId !== streamId || ack.sequence !== sequence || ack.state !== 'queued') throw new Error('设备未确认本次画面');
      if (this.current !== active) throw new Error('设备画面已停止');
      active.sequence = sequence; active.lastAt = Date.now();
      return { streamId, sequence, state: 'queued' };
    } finally { active.inFlight = false; }
  }
  async closeCurrent() {
    const old = this.current; this.current = null;
    if (!old) return;
    old.controller.abort();
    await this.request(old.device, 'display', { body: { protocol: 1, action: 'stop', streamId: old.streamId } }).catch(() => {});
  }
  async stop(clientId, streamId) {
    return this.exclusive(async () => {
      if (this.current?.clientId === clientId && this.current?.streamId === streamId) await this.closeCurrent();
      return { state: 'stopped', streamId };
    });
  }
  dispose() { return this.exclusive(() => this.closeCurrent()); }
}
