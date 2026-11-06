import { randomUUID } from 'node:crypto';
import { synthesizeVolcWebSocket } from './volc-websocket.js';
import { outputFormat, audioResult } from './audio-format.js';

export const VOLC_ENDPOINTS = Object.freeze({ websocket: 'wss://openspeech.bytedance.com/api/v3/tts/bidirection', sse: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse' });

export const PROVIDERS = [
  { id: 'volcengine', name: '火山引擎 · 豆包语音 V3', transport: 'websocket', endpoint: VOLC_ENDPOINTS.websocket, model: '', voice: 'zh_female_vv_uranus_bigtts', resourceId: 'seed-tts-2.0', authMode: 'api-key', speed: 0 },
  { id: 'openai', name: 'OpenAI 兼容 · Audio Speech', endpoint: '', model: '', voice: '', resourceId: '', authMode: 'api-key', speed: 1 },
  { id: 'minimax', name: 'MiniMax · 同步 HTTP', endpoint: 'https://api.minimax.cn/v1/t2a_v2', model: '', voice: '', resourceId: '', authMode: 'api-key', speed: 1 },
];
const MAX_RESPONSE = 32 * 1024 * 1024;

export function endpointUrl(value, schemes = ['http:', 'https:']) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请填写完整的接口地址'); }
  if (!schemes.includes(url.protocol) || url.username || url.password || url.hash) throw new Error(`接口地址须使用 ${schemes.map(s => s.slice(0, -1)).join('/')}，且不能包含凭据或片段`);
  return url.href;
}

export async function readLimited(response, max = MAX_RESPONSE) {
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body || []) {
    length += chunk.length;
    if (length > max) throw new Error('提供商响应超出大小限制');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function buildRequest(config, text) {
  const output = outputFormat(config);
  if (!config.voice) throw new Error('请配置音色 ID');
  const headers = { 'Content-Type': 'application/json' };
  let body;
  if (config.id === 'volcengine') {
    if (!config.resourceId) throw new Error('请配置火山 Resource ID');
    if (config.authMode === 'legacy') {
      if (!config.appId || !config.accessToken) throw new Error('请配置 App ID 和 Access Token');
      headers['X-Api-App-Id'] = config.appId;
      headers['X-Api-Access-Key'] = config.accessToken;
    } else {
      if (!config.apiKey) throw new Error('请配置火山语音 API Key');
      headers['X-Api-Key'] = config.apiKey;
    }
    headers['X-Api-Resource-Id'] = config.resourceId;
    headers['X-Api-Request-Id'] = randomUUID();
    const params = { speaker: config.voice, ...(config.model ? { model: config.model } : {}), audio_params: { format: output.format, sample_rate: 24000, speech_rate: config.speed } };
    if ((config.transport || 'websocket') === 'sse') params.text = text;
    body = { req_params: params };
  } else {
    if (!config.model) throw new Error('请配置模型 ID');
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    if (config.id === 'openai') {
      body = { input: text, model: config.model, voice: config.voice, speed: config.speed, response_format: output.format };
    } else if (config.id === 'minimax') {
      if (!config.apiKey) throw new Error('请配置 MiniMax API Key');
      body = { text, model: config.model, stream: false, output_format: 'hex', voice_setting: { voice_id: config.voice, speed: config.speed, vol: 1, pitch: 0 }, audio_setting: { sample_rate: output.format === 'pcm' ? 24000 : 32000, ...(output.format === 'mp3' ? { bitrate: 128000 } : {}), format: output.format, channel: 1 } };
    } else throw new Error('不支持的 provider');
  }
  const websocket = config.id === 'volcengine' && (config.transport || 'websocket') === 'websocket';
  return { url: endpointUrl(config.endpoint, websocket ? ['wss:', 'ws:'] : ['https:', 'http:']), headers, body, transport: websocket ? 'websocket' : 'http', output };
}

function decodeBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) throw new Error('火山返回了无效的音频编码');
  return Buffer.from(value, 'base64');
}

export function decodeVolcSSE(text) {
  const buffers = [];
  let completed = false;
  for (const record of text.replace(/\r\n/g, '\n').split('\n\n')) {
    const data = record.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    if (!data) continue;
    let frame;
    try { frame = JSON.parse(data); } catch { throw new Error('火山 SSE 响应不是有效 JSON'); }
    if (frame.code !== 0 && frame.code !== 20000000) throw new Error(`火山合成失败（code=${Number(frame.code) || 'unknown'}），请检查凭据、资源和音色`);
    if (frame.data) buffers.push(decodeBase64(frame.data));
    if (frame.code === 20000000) completed = true;
  }
  if (!completed) throw new Error('火山音频流未正常结束，请重试');
  return Buffer.concat(buffers);
}

export async function synthesize(config, text, signal, fetchImpl = fetch) {
  const request = buildRequest(config, text);
  if (request.transport === 'websocket') return synthesizeVolcWebSocket(request, text, signal);
  const response = await fetchImpl(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), redirect: 'error', signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(90000)]) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`TTS 请求失败（HTTP ${response.status}），请检查接口和凭据`); }
  const raw = await readLimited(response);
  let bytes;
  if (config.id === 'volcengine') bytes = decodeVolcSSE(raw.toString('utf8'));
  else if (config.id === 'minimax') {
    let json;
    try { json = JSON.parse(raw.toString('utf8')); } catch { throw new Error('MiniMax 响应不是有效 JSON'); }
    if (json.base_resp?.status_code !== 0) throw new Error(`MiniMax 合成失败（code=${Number(json.base_resp?.status_code) || 'unknown'}）`);
    if (request.output.format === 'pcm' && json.extra_info) {
      const info = json.extra_info;
      if ((info.audio_format !== undefined && info.audio_format !== 'pcm') ||
          (info.audio_sample_rate !== undefined && info.audio_sample_rate !== 24000) ||
          (info.audio_channel !== undefined && info.audio_channel !== 1)) {
        throw new Error('MiniMax 未返回所请求的 24000Hz 单声道 PCM');
      }
    }
    const audio = json.data?.audio;
    if (typeof audio !== 'string' || !/^(?:[a-fA-F0-9]{2})+$/.test(audio)) throw new Error('MiniMax 未返回有效 hex 音频');
    bytes = Buffer.from(audio, 'hex');
  } else {
    const type = response.headers.get('content-type') || '';
    if (!type.startsWith('audio/') && !type.startsWith('application/octet-stream')) throw new Error('Speech 接口未返回音频，请核对 endpoint');
    if (request.output.format === 'pcm' && /^audio\/(?:mpeg|mp3|wav|x-wav|ogg|opus|flac|aac)(?:;|$)/i.test(type)) {
      throw new Error('Speech 接口未返回原始 PCM，请核对 response_format 支持');
    }
    bytes = raw;
  }
  return audioResult(bytes, request.output);
}
