import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, synthesize, VOLC_ENDPOINTS } from '../providers/tts.js';
import { audioResult } from '../providers/audio-format.js';
import { serverFrame, mockVolc } from './helpers/volc-server.mjs';

const pcm = Buffer.from([0, 0, 255, 127, 0, 128, 1, 0]);
const config = id => ({ id, model: 'model', voice: 'voice', apiKey: 'placeholder', resourceId: 'seed-tts-2.0', speed: id === 'volcengine' ? 0 : 1,
  transport: 'sse', endpoint: id === 'volcengine' ? VOLC_ENDPOINTS.sse : 'https://example.invalid/speech' });
const hardware = id => ({ ...config(id), audioFormat: 'pcm', sampleRate: 24000 });
const expected = bytes => ({ bytes, mime: 'audio/pcm', sampleRate: 24000, channels: 1, format: 'pcm_s16le' });
const sse = bytes => new Response(`data: ${JSON.stringify({ code: 0, data: bytes.toString('base64') })}\n\ndata: {"code":20000000}\n\n`);
const mini = (bytes, extra_info) => Response.json({ base_resp: { status_code: 0 }, data: { audio: bytes.toString('hex') }, ...(extra_info ? { extra_info } : {}) });

test('硬件显式请求三种 provider 的 PCM24k，浏览器默认 MP3 保持原样', () => {
  const volc = buildRequest(hardware('volcengine'), '正文');
  assert.deepEqual(volc.body.req_params.audio_params, { format: 'pcm', sample_rate: 24000, speech_rate: 0 });
  const openai = buildRequest(hardware('openai'), '正文');
  assert.equal(openai.body.response_format, 'pcm');
  assert.equal(openai.body.sample_rate, undefined, 'Speech PCM rate is fixed by the provider, not a request parameter');
  const minimax = buildRequest(hardware('minimax'), '正文');
  assert.deepEqual(minimax.body.audio_setting, { sample_rate: 24000, format: 'pcm', channel: 1 });
  assert.equal(buildRequest(config('volcengine'), '正文').body.req_params.audio_params.format, 'mp3');
  assert.equal(buildRequest(config('openai'), '正文').body.response_format, 'mp3');
  assert.deepEqual(buildRequest(config('minimax'), '正文').body.audio_setting, { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 });
  assert.throws(() => buildRequest({ ...hardware('openai'), sampleRate: 16000 }, '正文'), /24000/);
  assert.throws(() => buildRequest({ ...config('openai'), audioFormat: 'wav' }, '正文'), /格式/);
});

test('HTTP 三种独立解码均返回完整 PCM 元数据，默认 MP3 返回形状不变', async () => {
  const cases = [
    ['volcengine', () => sse(pcm)],
    ['openai', () => new Response(pcm, { headers: { 'Content-Type': 'application/octet-stream' } })],
    ['minimax', () => mini(pcm, { audio_format: 'pcm', audio_sample_rate: 24000, audio_channel: 1 })],
  ];
  for (const [id, mock] of cases) {
    assert.deepEqual(await synthesize(hardware(id), '正文', undefined, mock), expected(pcm));
    assert.deepEqual(await synthesize(config(id), '正文', undefined, mock), { bytes: pcm, mime: 'audio/mpeg' });
  }
});

test('拒绝空、奇数长度或容器音频，不把忽略格式请求的输出作为 PCM 播放', async () => {
  for (const bad of [Buffer.alloc(0), Buffer.from([1]), Buffer.from('RIFF0000'), Buffer.from('OggS0000'), Buffer.from('fLaC0000'), Buffer.from('ID3abc')]) {
    await assert.rejects(synthesize(hardware('openai'), '正文', undefined, () => new Response(bad, { headers: { 'Content-Type': 'audio/pcm' } })), /空音频|16 位|原始 PCM/);
  }
  await assert.rejects(synthesize(hardware('openai'), '正文', undefined, () => new Response(pcm, { headers: { 'Content-Type': 'audio/mpeg' } })), /原始 PCM/);
  assert.deepEqual(audioResult(Buffer.from('ID3abc')), { bytes: Buffer.from('ID3abc'), mime: 'audio/mpeg' });
});

test('MiniMax 返回元数据与请求不符时失败，不错误标记采样率或声道', async () => {
  for (const info of [{ audio_format: 'mp3' }, { audio_sample_rate: 32000 }, { audio_channel: 2 }]) {
    await assert.rejects(synthesize(hardware('minimax'), '正文', undefined, () => mini(pcm, info)), /24000Hz 单声道 PCM/);
  }
});

test('真实本地火山 WebSocket 的 PCM 多帧总长度与元数据正确，单帧可为奇数', async () => {
  let session;
  const mock = await mockVolc((frame, socket) => {
    if (frame.event === 1) socket.send(serverFrame(50));
    if (frame.event === 100) {
      session = frame.sessionId;
      assert.equal(frame.payload.req_params.audio_params.format, 'pcm');
      assert.equal(frame.payload.req_params.audio_params.sample_rate, 24000);
      socket.send(serverFrame(150, { sessionId: session }));
    }
    if (frame.event === 102) {
      socket.send(serverFrame(352, { sessionId: session, audio: true, payload: pcm.subarray(0, 1) }));
      socket.send(serverFrame(352, { sessionId: session, audio: true, payload: pcm.subarray(1) }));
      socket.send(serverFrame(152, { sessionId: session }));
    }
    if (frame.event === 2) socket.send(serverFrame(52));
  });
  try {
    const result = await synthesize({ ...hardware('volcengine'), transport: 'websocket', endpoint: mock.url }, '正文');
    assert.deepEqual(result, expected(pcm));
    assert.deepEqual(mock.errors, []);
  } finally { await mock.close(); }
});

test('火山 WebSocket 全部完成仍拒绝最终奇数长度 PCM', async () => {
  let session;
  const mock = await mockVolc((frame, socket) => {
    if (frame.event === 1) socket.send(serverFrame(50));
    if (frame.event === 100) { session = frame.sessionId; socket.send(serverFrame(150, { sessionId: session })); }
    if (frame.event === 102) {
      socket.send(serverFrame(352, { sessionId: session, audio: true, payload: Buffer.from([1, 2, 3]) }));
      socket.send(serverFrame(152, { sessionId: session }));
    }
    if (frame.event === 2) socket.send(serverFrame(52));
  });
  try {
    await assert.rejects(synthesize({ ...hardware('volcengine'), transport: 'websocket', endpoint: mock.url }, '正文'), /火山|PCM/);
  } finally { await mock.close(); }
});
