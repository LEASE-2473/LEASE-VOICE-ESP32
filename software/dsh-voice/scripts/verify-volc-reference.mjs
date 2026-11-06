import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { encodeRequest, decodeFrame } from '../providers/volc-protocol.js';
import { serverFrame } from '../tests/helpers/volc-server.mjs';

const file = process.argv[2];
if (!file) throw new Error('请传入官方文档附件中解压出的 protocols_.py 路径');
const requests = [
  [1, {}, ''],
  [100, { event: 100, req_params: { speaker: 'voice', audio_params: { format: 'mp3', sample_rate: 24000 } } }, 'ref-session'],
  [200, { event: 200, req_params: { text: '你好，世界' } }, 'ref-session'],
  [102, {}, 'ref-session'], [101, {}, 'ref-session'], [2, {}, ''],
].map(([event, payload, sessionId]) => ({ event, payload, sessionId, encoded: encodeRequest(event, payload, sessionId).toString('base64') }));
const responses = [serverFrame(50), serverFrame(150, { sessionId: 'ref-session' }), serverFrame(352, { sessionId: 'ref-session', audio: true, payload: Buffer.from([0x49, 0x44, 0x33, 0, 255]) }), serverFrame(152, { sessionId: 'ref-session' }), serverFrame(52), serverFrame(null, { errorCode: 45000001 })];
const script = `
import sys, json, types, importlib.util, base64
# 只加载离线协议编解码；不安装 Python websockets，也不建立网络连接。
stub = types.ModuleType('websockets')
stub.WebSocketClientProtocol = object
sys.modules['websockets'] = stub
spec = importlib.util.spec_from_file_location('volc_official_reference', sys.argv[1])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
data = json.loads(sys.stdin.buffer.read().decode('utf-8'))
checks = []
for item in data['requests']:
    message = module.Message(type=module.MsgType.FullClientRequest, flag=module.MsgTypeFlagBits.WithEvent)
    message.event = module.EventType(item['event'])
    message.session_id = item['sessionId']
    message.payload = json.dumps(item['payload'], ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    checks.append(message.marshal() == base64.b64decode(item['encoded']))
frames = []
for item in data['responses']:
    message = module.Message.from_bytes(base64.b64decode(item))
    frames.append({'type': int(message.type), 'event': int(message.event), 'sessionId': message.session_id, 'connectId': message.connect_id, 'errorCode': message.error_code, 'payload': base64.b64encode(message.payload).decode('ascii')})
print(json.dumps({'checks': checks, 'frames': frames}))
`;
const result = spawnSync(process.env.PYTHON || 'python', ['-c', script, file], { encoding: 'utf8', input: JSON.stringify({ requests, responses: responses.map(frame => frame.toString('base64')) }), timeout: 10000 });
assert.equal(result.status, 0, result.stderr);
const reference = JSON.parse(result.stdout);
assert.ok(reference.checks.every(Boolean), '请求帧须逐字节匹配官方编码器');
responses.forEach((bytes, index) => {
  const ours = decodeFrame(bytes), official = reference.frames[index];
  assert.deepEqual({ type: ours.type, event: ours.event || 0, sessionId: ours.sessionId, connectId: ours.connectId, errorCode: ours.errorCode, payload: ours.payload.toString('base64') }, official);
});
console.log('官方附件对照通过：6 种客户端请求逐字节一致；6 种服务端帧解析结果一致。未联网、未调用真实合成。');
