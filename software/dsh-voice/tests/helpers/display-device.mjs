import { createServer } from 'node:http';
import { displayConfig } from '../../extensions/display.js';

// Node 协议模拟器：验证电脑链路，不执行 ESP32 C/SPI，不冒充硬件仿真。
export async function displayDevice({ legacy = false, delay = 0, wrongAck = false } = {}) {
  const state = { protocol: 1, ok: true, ready: false, profile: 'off', width: 0, height: 0, format: 'rgb565be', streamId: '', lastSequence: 0, received: 0, drawn: 0, dropped: 0, timeouts: 0 };
  const frames = [], commands = [], receivedHeaders = [];
  let inFlight = 0, maxInFlight = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const send = (data, status = 200) => { res.writeHead(status); res.end(JSON.stringify(data)); };
    if (req.headers.authorization !== 'Bearer screen-test-token') { send({ error: 'unauthorized' }, 401); return; }
    if (req.url === '/lease-voice/v1/info') { send({ protocol: 1, kind: 'lease-voice-esp32', capabilities: legacy ? ['audio-pcm16'] : ['audio-pcm16', 'display-rgb565', 'display-config'] }); return; }
    if (req.url === '/lease-voice/v1/display' && req.method === 'GET') { send(state); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = Buffer.concat(chunks);
    if (req.url === '/lease-voice/v1/display') {
      const input = JSON.parse(body); commands.push(input);
      if (input.action === 'configure') {
        if (state.streamId) { send({ error: 'busy' }, 409); return; }
        const { protocol, action, ...raw } = input; const selected = displayConfig(raw);
        Object.assign(state, selected.config, { width: selected.width, height: selected.height, ready: true });
      } else if (input.action === 'start') {
        if (state.streamId) { send({ error: 'busy' }, 409); return; }
        Object.assign(state, { streamId: input.streamId, lastSequence: 0 });
      } else if (input.action === 'stop' && input.streamId === state.streamId) state.streamId = '';
      send(state); return;
    }
    if (req.url === '/lease-voice/v1/frame') {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      receivedHeaders.push(req.headers);
      const stream = req.headers['x-lease-stream-id'], seq = Number(req.headers['x-lease-sequence']);
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (stream !== state.streamId || seq <= state.lastSequence || Number(req.headers['x-lease-width']) !== state.width || Number(req.headers['x-lease-height']) !== state.height || body.length !== state.width * state.height * 2) {
        inFlight--; send({ error: 'stale or invalid' }, 409); return;
      }
      frames.push(body); state.lastSequence = seq; state.received++; inFlight--;
      send({ protocol: 1, ok: true, streamId: stream, sequence: wrongAck ? seq + 1 : seq, state: 'queued' }, 202); return;
    }
    send({ error: 'missing' }, 404);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { endpoint: `http://127.0.0.1:${server.address().port}`, token: 'screen-test-token', state, frames, commands, receivedHeaders, get maxInFlight() { return maxInFlight; },
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
