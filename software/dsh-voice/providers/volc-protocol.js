import { gunzipSync } from 'node:zlib';

// 根据火山双向 TTS 文档所附 protocols.zip 的帧格式独立实现。
export const EVENT = Object.freeze({ START_CONNECTION: 1, FINISH_CONNECTION: 2, CONNECTION_STARTED: 50, CONNECTION_FAILED: 51, CONNECTION_FINISHED: 52, START_SESSION: 100, CANCEL_SESSION: 101, FINISH_SESSION: 102, SESSION_STARTED: 150, SESSION_CANCELED: 151, SESSION_FINISHED: 152, SESSION_FAILED: 153, USAGE: 154, TASK_REQUEST: 200, SENTENCE_START: 350, SENTENCE_END: 351, AUDIO: 352, SUBTITLE: 364 });
const connectionEvents = new Set([1, 2, 50, 51, 52]);
const connectionResponses = new Set([50, 51, 52]);
const MAX_BYTES = 32 * 1024 * 1024;
const word = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; };

export function encodeRequest(event, payload = {}, sessionId = '') {
  const parts = [Buffer.from([0x11, 0x14, 0x10, 0]), word(event)];
  if (!connectionEvents.has(event)) {
    if (!sessionId) throw new Error('火山会话 ID 不能为空');
    const id = Buffer.from(sessionId, 'utf8'); parts.push(word(id.length), id);
  }
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  parts.push(word(data.length), data);
  return Buffer.concat(parts);
}

export function decodeFrame(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < 8 || bytes.length > MAX_BYTES) throw new Error('火山二进制帧长度无效');
  const version = bytes[0] >> 4, headerLength = (bytes[0] & 15) * 4;
  const type = bytes[1] >> 4, flags = bytes[1] & 15;
  const serialization = bytes[2] >> 4, compression = bytes[2] & 15;
  if (version !== 1 || headerLength < 4 || headerLength > bytes.length || ![9, 11, 15].includes(type) || ![0, 1].includes(compression) || ![0, 1].includes(serialization)) throw new Error('火山二进制帧头无效');
  let offset = headerLength;
  const take = length => {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) throw new Error('火山二进制帧被截断');
    const part = bytes.subarray(offset, offset + length); offset += length; return part;
  };
  const number = () => take(4).readUInt32BE();
  const sized = () => take(number());
  const frame = { type, flags, event: null, sessionId: '', connectId: '', errorCode: 0, payload: null, json: null };
  if (type === 15) frame.errorCode = number();
  else if (flags & 1) frame.sequence = take(4).readInt32BE();
  if (flags & 4) {
    frame.event = number();
    if (connectionResponses.has(frame.event)) frame.connectId = sized().toString('utf8');
    else if (!connectionEvents.has(frame.event)) frame.sessionId = sized().toString('utf8');
  }
  const payload = sized();
  if (offset !== bytes.length) throw new Error('火山二进制帧包含多余数据');
  frame.payload = compression === 1 ? gunzipSync(payload, { maxOutputLength: MAX_BYTES }) : payload;
  if (type !== 11 && serialization === 1 && frame.payload.length) {
    try { frame.json = JSON.parse(frame.payload.toString('utf8')); } catch { throw new Error('火山控制消息不是有效 JSON'); }
  }
  return frame;
}
