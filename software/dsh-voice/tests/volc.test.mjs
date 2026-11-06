import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { buildRequest, synthesize } from '../providers/tts.js';
import { defaultConfig } from '../host/config.js';
import { encodeRequest, decodeFrame } from '../providers/volc-protocol.js';
import { synthesizeVolcWebSocket } from '../providers/volc-websocket.js';
import { serverFrame, mockVolc } from './helpers/volc-server.mjs';

const configured = endpoint => ({ ...defaultConfig().providers.volcengine, endpoint, apiKey: 'placeholder-key' });
const hello = (frame, socket) => {
  if (frame.event === 1) socket.send(serverFrame(50));
  if (frame.event === 100) socket.send(serverFrame(150, { sessionId: frame.sessionId }));
};

test('双向协议固定字节：StartConnection、FinishConnection、会话长度与 UTF-8', () => {
  assert.equal(encodeRequest(1).toString('hex'), '1114100000000001000000027b7d');
  assert.equal(encodeRequest(2).toString('hex'), '1114100000000002000000027b7d');
  assert.equal(encodeRequest(102, {}, 'id').toString('hex'), '1114100000000066000000026964000000027b7d');
  const frame = encodeRequest(200, { text: '你好' }, '会话');
  assert.equal(frame.readUInt32BE(8), Buffer.byteLength('会话'));
  assert.throws(() => encodeRequest(100), /不能为空/);
});

test('服务端帧解析：连接/会话 ID、二进制音频、压缩和错误；拒绝截断/多余字节', () => {
  assert.equal(decodeFrame(serverFrame(50)).connectId, 'connection-test');
  const sound = Buffer.from([0x49, 0x44, 0x33, 0, 255]);
  assert.deepEqual(decodeFrame(serverFrame(352, { sessionId: 's', audio: true, payload: sound })).payload, sound);
  const compressed = serverFrame(352, { sessionId: 's', audio: true, payload: gzipSync(sound), gzip: true });
  assert.deepEqual(decodeFrame(compressed).payload, sound);
  assert.equal(decodeFrame(serverFrame(null, { errorCode: 45000000, payload: { message: 'secret' } })).errorCode, 45000000);
  assert.throws(() => decodeFrame(serverFrame(150, { sessionId: 's' }).subarray(0, -1)), /截断/);
  assert.throws(() => decodeFrame(Buffer.concat([serverFrame(50), Buffer.from([0])])), /多余数据/);
});

test('真实本地 WebSocket：握手鉴权、建连/建会话/发文本/结束，音频多帧拼接', async () => {
  const events = [], chunks = [Buffer.from('ID3-a'), Buffer.from('audio-b')];
  let session;
  const mock = await mockVolc((frame, socket) => {
    events.push(frame.event);
    hello(frame, socket);
    if (frame.event === 100) {
      session = frame.sessionId;
      assert.equal(frame.payload.event, 100);
      assert.equal(frame.payload.req_params.audio_params.sample_rate, 24000);
      assert.equal(frame.payload.req_params.sample_rate, undefined);
      assert.equal(frame.payload.req_params.audio_params.bit_rate, undefined);
      assert.equal(frame.payload.req_params.speaker, configured('').voice);
      assert.equal(frame.payload.req_params.context_texts, undefined);
      assert.equal(frame.payload.req_params.text, undefined);
    }
    if (frame.event === 200) { assert.equal(frame.payload.req_params.text, '完整回复'); assert.equal(frame.sessionId, session); }
    if (frame.event === 102) {
      socket.send(serverFrame(350, { sessionId: session, payload: { text: 'meta' } }));
      for (const chunk of chunks) socket.send(serverFrame(352, { sessionId: session, audio: true, payload: chunk }));
      socket.send(serverFrame(351, { sessionId: session }));
      socket.send(serverFrame(152, { sessionId: session }));
    }
    if (frame.event === 2) socket.send(serverFrame(52));
  }, req => {
    assert.equal(req.headers['x-api-key'], 'placeholder-key');
    assert.equal(req.headers['x-api-resource-id'], 'seed-tts-2.0');
    assert.ok(req.headers['x-api-connect-id']);
  });
  try {
    const result = await synthesize(configured(mock.url), '完整回复');
    assert.deepEqual(result.bytes, Buffer.concat(chunks)); assert.equal(result.mime, 'audio/mpeg');
    assert.deepEqual(events, [1, 100, 200, 102, 2]); assert.deepEqual(mock.errors, []);
  } finally { await mock.close(); }
});

test('WebSocket 失败/错误码/会话错配/截断音频不得返回成功，错误不回显密钥', async () => {
  for (const mode of ['failed', 'error', 'wrong-session', 'partial', 'empty', 'text']) {
    const mock = await mockVolc((frame, socket) => {
      hello(frame, socket);
      if (frame.event !== 102) return;
      const sessionId = frame.sessionId;
      if (mode === 'failed') socket.send(serverFrame(153, { sessionId, payload: { code: 45000000, message: 'placeholder-key leaked' } }));
      if (mode === 'error') socket.send(serverFrame(null, { errorCode: 45000001, payload: { message: 'placeholder-key leaked' } }));
      if (mode === 'wrong-session') socket.send(serverFrame(352, { sessionId: 'wrong', audio: true, payload: Buffer.from('bad') }));
      if (mode === 'partial') { socket.send(serverFrame(352, { sessionId, audio: true, payload: Buffer.from('partial') })); socket.close(); }
      if (mode === 'empty') socket.send(serverFrame(152, { sessionId }));
      if (mode === 'text') socket.send('{"data":"wrong"}');
    });
    try {
      await assert.rejects(synthesizeVolcWebSocket(buildRequest(configured(mock.url), '文字'), '文字', undefined, { timeoutMs: 1000 }), error => /^火山/.test(error.message) && !error.message.includes('placeholder-key'));
      assert.deepEqual(mock.errors, []);
    } finally { await mock.close(); }
  }
});

test('取消发送 CancelSession 并释放 socket；超时不留下悬挂任务', async () => {
  let ready;
  const taskReady = new Promise(resolve => { ready = resolve; });
  let canceled;
  const cancelReceived = new Promise(resolve => { canceled = resolve; });
  const mock = await mockVolc((frame, socket) => {
    hello(frame, socket);
    if (frame.event === 102) ready();
    if (frame.event === 101) canceled();
  });
  try {
    const controller = new AbortController();
    const pending = synthesizeVolcWebSocket(buildRequest(configured(mock.url), '文字'), '文字', controller.signal, { timeoutMs: 2000 });
    const assertion = assert.rejects(pending, { name: 'AbortError' });
    await taskReady; controller.abort(); await assertion;
    await Promise.race([cancelReceived, new Promise((_, reject) => setTimeout(() => reject(new Error('no cancel frame')), 500))]);
    await assert.rejects(synthesizeVolcWebSocket(buildRequest(configured(mock.url), '文字'), '文字', undefined, { timeoutMs: 50 }), /超时/);
  } finally { await mock.close(); }
});

test('HTTP 握手拒绝和重定向被拦截，不把凭据转发到新地址', async () => {
  let hits = 0;
  const server = createServer((_req, res) => { hits++; res.writeHead(302, { Location: 'http://127.0.0.1:9/leak' }); res.end('private response'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `ws://127.0.0.1:${server.address().port}`;
    await assert.rejects(synthesizeVolcWebSocket(buildRequest(configured(url), '文字'), '文字', undefined, { timeoutMs: 1000 }), /HTTP 302/);
    assert.equal(hits, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
