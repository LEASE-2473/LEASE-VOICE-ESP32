import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { EVENT, encodeRequest, decodeFrame } from './volc-protocol.js';
import { audioResult } from './audio-format.js';

export function synthesizeVolcWebSocket(request, text, signal, { WebSocketImpl = WebSocket, timeoutMs = 90000 } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const sessionId = randomUUID();
    const socket = new WebSocketImpl(request.url, { headers: { ...request.headers, 'X-Api-Connect-Id': randomUUID() }, handshakeTimeout: Math.min(10000, timeoutMs), maxPayload: 32 * 1024 * 1024, followRedirects: false, perMessageDeflate: false });
    let phase = 'connecting', settled = false, total = 0;
    const audio = [];
    const send = (event, payload = {}) => socket.send(encodeRequest(event, payload, sessionId));
    const cleanup = () => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (socket.readyState === WebSocket.OPEN) socket.close(1000);
      else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      if (socket.readyState === WebSocket.CLOSED) return;
      const force = setTimeout(() => { if (socket.readyState !== WebSocket.CLOSED) socket.terminate(); }, 500);
      force.unref?.();
      socket.once('close', () => clearTimeout(force));
    };
    const fail = error => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => {
      if (socket.readyState === WebSocket.OPEN && ['session', 'audio'].includes(phase)) {
        try { send(EVENT.CANCEL_SESSION); send(EVENT.FINISH_CONNECTION); } catch { /* 仍须释放连接 */ }
      }
      fail(signal.reason || new DOMException('已取消', 'AbortError'));
    };
    const timer = setTimeout(() => fail(new Error('火山 WebSocket 合成超时')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    socket.on('open', () => {
      if (settled) return;
      phase = 'connection';
      try { send(EVENT.START_CONNECTION); } catch { fail(new Error('火山 WebSocket 无法发送建连消息')); }
    });
    socket.on('unexpected-response', (_req, response) => {
      response.resume();
      fail(new Error(`火山 WebSocket 握手失败（HTTP ${response.statusCode}），请检查语音 API Key、Resource ID 和接口地址`));
    });
    socket.on('error', () => fail(new Error('火山 WebSocket 连接失败，请检查网络、接口和语音凭据')));
    socket.on('close', () => { if (!settled) fail(new Error('火山 WebSocket 提前断开，音频未正常完成')); });
    socket.on('message', (data, isBinary) => {
      if (settled) return;
      try {
        if (!isBinary) throw new Error('火山返回了非二进制 WebSocket 消息');
        const frame = decodeFrame(data);
        if (frame.type === 15 || [EVENT.CONNECTION_FAILED, EVENT.SESSION_FAILED, EVENT.SESSION_CANCELED].includes(frame.event)) {
          const code = frame.errorCode || frame.json?.status_code || frame.json?.code;
          throw new Error(`火山 WebSocket 合成失败（event=${frame.event ?? 'error'}${Number.isSafeInteger(code) ? `，code=${code}` : ''}），请检查账号授权、资源与音色`);
        }
        if (frame.sessionId && frame.sessionId !== sessionId) throw new Error('火山响应会话 ID 不匹配');
        if (phase === 'connection' && frame.type === 9 && frame.event === EVENT.CONNECTION_STARTED) {
          phase = 'session';
          send(EVENT.START_SESSION, { event: EVENT.START_SESSION, req_params: request.body.req_params });
        } else if (phase === 'session' && frame.type === 9 && frame.event === EVENT.SESSION_STARTED && frame.sessionId === sessionId) {
          phase = 'audio';
          send(EVENT.TASK_REQUEST, { event: EVENT.TASK_REQUEST, req_params: { ...request.body.req_params, text } });
          send(EVENT.FINISH_SESSION);
        } else if (phase === 'audio' && frame.type === 11 && (frame.event === EVENT.AUDIO || frame.event === null)) {
          total += frame.payload.length;
          if (total > 32 * 1024 * 1024) throw new Error('火山音频超出大小限制');
          audio.push(frame.payload);
        } else if (phase === 'audio' && frame.type === 9 && frame.event === EVENT.SESSION_FINISHED && frame.sessionId === sessionId) {
          if (!total) throw new Error('火山返回了空音频');
          phase = 'finishing'; send(EVENT.FINISH_CONNECTION);
        } else if (phase === 'finishing' && frame.type === 9 && frame.event === EVENT.CONNECTION_FINISHED) {
          const result = audioResult(Buffer.concat(audio, total), request.output);
          settled = true; cleanup(); resolve(result);
        } else if (phase === 'audio' && frame.type === 9 && [EVENT.SENTENCE_START, EVENT.SENTENCE_END, EVENT.SUBTITLE, EVENT.USAGE].includes(frame.event)) {
          // 文本/用量元数据不是音频，不拼接进产物。
        } else throw new Error('火山 WebSocket 响应顺序或事件类型不符合协议');
      } catch (error) {
        fail(/^火山/.test(error.message) ? error : new Error('火山 WebSocket 响应解析失败'));
      }
    });
    if (signal?.aborted) abort();
  });
}
