import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PROVIDERS, endpointUrl, VOLC_ENDPOINTS } from '../providers/tts.js';

const secrets = ['apiKey', 'accessToken'];
export const defaultConfig = () => ({ version: 1, mode: 'manual', outputTarget: 'browser', completion: { enabled: false, target: 'browser', volume: 35, sound: 'ding', clipIds: [] }, activeProvider: 'volcengine', providers: Object.fromEntries(PROVIDERS.map(p => [p.id, { ...p, apiKey: '', appId: '', accessToken: '' }])), device: { endpoint: '', token: '', name: '我的 ESP32-S3' } });
export function publicConfig(config) {
  const copy = structuredClone(config);
  for (const provider of [...Object.values(copy.providers), ...Object.values(copy.profiles || {}).flatMap(p => Object.values(p.providers))]) {
    for (const key of secrets) { provider[`${key}Set`] = !!provider[key]; delete provider[key]; }
  }
  copy.device.tokenSet = !!copy.device.token;
  delete copy.device.token;
  return copy;
}
const string = (value, max = 2048) => {
  if (typeof value !== 'string' || value.length > max || /[\r\n\0]/.test(value)) throw new Error('配置字段格式不正确');
  return value.trim();
};
export function updateConfig(current, input) {
  const next = structuredClone(current);
  if (input.completion !== undefined) {
    const c = input.completion;
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('配置完成提示格式无效');
    next.completion ||= { enabled: false, target: 'browser', volume: 35 };
    if (c.enabled !== undefined) {
      if (typeof c.enabled !== 'boolean') throw new Error('配置完成提示开关无效');
      next.completion.enabled = c.enabled;
    }
    if (c.target !== undefined) {
      if (!['browser', 'esp32'].includes(c.target)) throw new Error('配置完成提示目标无效');
      next.completion.target = c.target;
    }
    if (c.volume !== undefined) {
      if (!Number.isInteger(c.volume) || c.volume < 0 || c.volume > 100) throw new Error('配置提示音音量须为 0 至 100 的整数');
      next.completion.volume = c.volume;
    }
    if (c.sound !== undefined) {
      if (!['ding', 'random', 'selected'].includes(c.sound)) throw new Error('配置提示声音模式无效');
      next.completion.sound = c.sound;
    }
    if (c.clipIds !== undefined) {
      if (!Array.isArray(c.clipIds) || c.clipIds.length > 200 || c.clipIds.some(x => typeof x !== 'string' || !/^[a-f0-9]{64}$/.test(x))) throw new Error('配置提示语音列表无效');
      next.completion.clipIds = [...new Set(c.clipIds)];
    }
  }
  if (input.mode !== undefined) {
    if (!['manual', 'auto'].includes(input.mode)) throw new Error('朗读模式无效');
    next.mode = input.mode;
  }
  if (input.outputTarget !== undefined) {
    if (!['browser', 'esp32'].includes(input.outputTarget)) throw new Error('配置播放目标无效');
    next.outputTarget = input.outputTarget;
  }
  if (input.activeProvider !== undefined) {
    if (!PROVIDERS.some(p => p.id === input.activeProvider)) throw new Error('Provider 无效');
    next.activeProvider = input.activeProvider;
  }
  if (input.provider) {
    const p = input.provider;
    if (!Object.hasOwn(next.providers, p.id)) throw new Error('Provider 无效');
    const target = next.providers[p.id];
    for (const key of ['endpoint', 'model', 'voice', 'resourceId', 'appId', 'authMode', 'transport']) {
      if (p[key] !== undefined) target[key] = string(p[key]);
    }
    if (p.id === 'volcengine' && !['websocket', 'sse'].includes(target.transport)) throw new Error('火山传输协议无效');
    if (target.endpoint) endpointUrl(target.endpoint, p.id === 'volcengine' && target.transport === 'websocket' ? ['wss:', 'ws:'] : ['http:', 'https:']);
    if (!['api-key', 'legacy'].includes(target.authMode)) throw new Error('鉴权模式无效');
    for (const key of secrets) {
      if (p[`clear${key[0].toUpperCase()}${key.slice(1)}`] === true) target[key] = '';
      if (p[key]) target[key] = string(p[key], 4096);
    }
    if (p.speed !== undefined) target.speed = Number(p.speed);
    const range = p.id === 'volcengine' ? [-50, 100] : p.id === 'minimax' ? [0.5, 2] : [0.25, 4];
    if (!Number.isFinite(target.speed) || target.speed < range[0] || target.speed > range[1] || (p.id === 'volcengine' && !Number.isInteger(target.speed))) throw new Error(`语速须在 ${range.join(' 至 ')} 范围内${p.id === 'volcengine' ? '，且为整数' : ''}`);
  }
  if (input.device) {
    for (const key of ['endpoint', 'name']) if (input.device[key] !== undefined) next.device[key] = string(input.device[key]);
    if (next.device.endpoint) {
      const url = new URL(endpointUrl(next.device.endpoint));
      if (url.search) throw new Error('设备地址不能包含查询参数');
      next.device.endpoint = url.href.replace(/\/$/, '');
    }
    if (input.device.clearToken === true) next.device.token = '';
    if (input.device.token) next.device.token = string(input.device.token, 4096);
  }
  next.profiles ||= {};
  if (input.profile) {
    const { action, name } = input.profile;
    const key = string(name, 80);
    if (!key || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('配置档名称无效');
    if (action === 'save') {
      if (!Object.hasOwn(next.profiles, key) && Object.keys(next.profiles).length >= 50) throw new Error('最多保存50份配置');
      next.profiles[key] = { activeProvider: next.activeProvider, providers: structuredClone(next.providers) };
    } else if (action === 'select') {
      if (!Object.hasOwn(next.profiles, key)) throw new Error('配置档不存在');
      next.activeProvider = next.profiles[key].activeProvider;
      next.providers = structuredClone(next.profiles[key].providers);
    } else if (action === 'delete') delete next.profiles[key];
    else throw new Error('配置档操作无效');
  }
  return next;
}

export function createConfigStore(directory) {
  const file = join(directory, 'config.json');
  let value = defaultConfig();
  let migrationNotice = '';
  if (existsSync(file)) {
    const disk = JSON.parse(readFileSync(file, 'utf8'));
    if (disk.version !== 1) throw new Error('VOICE 配置版本不支持');
    value = updateConfig(value, { mode: disk.mode, outputTarget: disk.outputTarget, completion: disk.completion, activeProvider: disk.activeProvider, device: disk.device });
    for (const original of Object.values(disk.providers || {})) {
      const provider = { ...original };
      if (provider.id === 'volcengine' && !Object.hasOwn(provider, 'transport')) {
        if (!provider.endpoint || [VOLC_ENDPOINTS.sse, 'https://openspeech.bytedance.com/api/v3/tts/bidirection', 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'].includes(provider.endpoint.replace(/\/$/, ''))) {
          provider.transport = 'websocket'; provider.endpoint = VOLC_ENDPOINTS.websocket;
          migrationNotice = '旧版火山默认接口已在内存中适配为双向 WebSocket，凭据保持不变；点击保存后写入配置。';
        } else provider.transport = /^wss?:/.test(provider.endpoint) ? 'websocket' : 'sse';
      }
      value = updateConfig(value, { provider });
    }
  }
  if (existsSync(file)) {
    const disk = JSON.parse(readFileSync(file, 'utf8'));
    for (const [name, profile] of Object.entries(disk.profiles || {})) {
      let checked = defaultConfig();
      for (const provider of Object.values(profile.providers || {})) checked = updateConfig(checked, { provider });
      checked = updateConfig(checked, { activeProvider: profile.activeProvider, profile: { action: 'save', name } });
      value.profiles = { ...value.profiles, ...checked.profiles };
    }
  }
  return {
    get: () => structuredClone(value),
    public: () => ({ ...publicConfig(value), ttsProtocolVersion: 2, deviceAudioProtocolVersion: 1, migrationNotice }),
    save(input) {
      const next = updateConfig(value, input);
      mkdirSync(directory, { recursive: true });
      const temp = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      renameSync(temp, file);
      value = next;
      migrationNotice = '';
      return { ...publicConfig(value), ttsProtocolVersion: 2, deviceAudioProtocolVersion: 1, migrationNotice };
    },
  };
}
