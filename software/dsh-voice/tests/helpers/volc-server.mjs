import { WebSocketServer } from 'ws';

const word = value => { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; };
// 测试端独立编码，不调用生产 parser/encoder，以免同一错误互相验证。
export function serverFrame(event, { sessionId = '', payload = {}, audio = false, errorCode, gzip = false } = {}) {
  const parts = [Buffer.from([0x11, errorCode !== undefined ? 0xf0 : audio ? 0xb4 : 0x94, (audio ? 0 : 0x10) | (gzip ? 1 : 0), 0])];
  if (errorCode !== undefined) parts.push(word(errorCode));
  else {
    parts.push(word(event));
    const identity = Buffer.from([50, 51, 52].includes(event) ? 'connection-test' : sessionId);
    parts.push(word(identity.length), identity);
  }
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
  parts.push(word(body.length), body);
  return Buffer.concat(parts);
}
export function clientFrame(input) {
  const b = Buffer.from(input);
  if (b.subarray(0, 4).toString('hex') !== '11141000') throw new Error('invalid client header');
  const event = b.readUInt32BE(4);
  let offset = 8, sessionId = '';
  if (![1, 2].includes(event)) {
    const length = b.readUInt32BE(offset); offset += 4;
    sessionId = b.subarray(offset, offset + length).toString(); offset += length;
  }
  const size = b.readUInt32BE(offset); offset += 4;
  if (offset + size !== b.length) throw new Error('invalid client size');
  return { event, sessionId, payload: JSON.parse(b.subarray(offset).toString('utf8')) };
}
export async function mockVolc(onFrame, onConnect = () => {}) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1', perMessageDeflate: false });
  const errors = [];
  server.on('connection', (socket, request) => {
    try { onConnect(request); } catch (error) { errors.push(error); socket.terminate(); }
    socket.on('error', () => {});
    socket.on('message', (bytes, isBinary) => {
      try {
        if (!isBinary) throw new Error('client must send binary');
        onFrame(clientFrame(bytes), socket);
      } catch (error) { errors.push(error); socket.terminate(); }
    });
  });
  await new Promise(resolve => server.once('listening', resolve));
  return { url: `ws://127.0.0.1:${server.address().port}`, errors, close: () => { for (const client of server.clients) client.terminate(); return new Promise(resolve => server.close(resolve)); } };
}
