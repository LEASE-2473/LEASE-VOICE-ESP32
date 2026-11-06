// One short real synthesis through the same TaskService used by DSH.
// Credentials are read locally and never printed or copied into the report.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createConfigStore } from '../software/dsh-voice/host/config.js';
import { TaskService } from '../software/dsh-voice/core/tasks.js';
import { synthesize } from '../software/dsh-voice/providers/tts.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const installed = process.env.LEASE_VOICE_INSTALLED_DATA || 'D:/LEASE AI Software/Deepseek Harness/profiles/web/node_modules/dsh-lease-voice/data';
const config = createConfigStore(installed).get();
const device = JSON.parse(readFileSync(join(root, 'tools/data/device.json'), 'utf8'));
config.device = { ...config.device, endpoint: device.endpoint, token: device.token };
config.outputTarget = 'esp32';
const destination = join(root, 'firmware/esp32-s3/artifacts/acceptance');
mkdirSync(destination, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const replay = process.argv.includes('--replay');
const existing = replay ? readdirSync(destination).filter(name => name.startsWith('m2-real-phrase-') && name.endsWith('.pcm')).sort().at(-1) : null;
if (replay && !existing) throw new Error('没有已保存的真实 PCM 音频');
const report = { provider: config.activeProvider, target: 'esp32', cachedReplay: replay, states: [], audio: [], hardwareSoundConfirmed: false };
const tasks = new TaskService({ get: () => structuredClone(config) }, async (...args) => {
  const audio = replay ? { bytes: readFileSync(join(destination, existing)), sampleRate: 24000, channels: 1, format: 'pcm_s16le', mime: 'audio/pcm' } : await synthesize(...args);
  const name = `m2-real-phrase-${stamp}-${report.audio.length}.pcm`;
  writeFileSync(join(destination, name), audio.bytes);
  report.audio.push({ file: name, bytes: audio.bytes.length, sampleRate: audio.sampleRate,
    channels: audio.channels, format: audio.format, durationSeconds: audio.bytes.length / (audio.sampleRate * 2) });
  return audio;
});
const clientId = 'hardware-real-tts';
try {
  const started = tasks.start({ text: '你好呀，语音已经接到这个小喇叭上啦。', clientId, generation: 0 });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const task = tasks.view(tasks.get(started.id, clientId));
    if (report.states.at(-1) !== task.state) {
      report.states.push(task.state);
      console.log(JSON.stringify({ state: task.state, completed: task.completed, total: task.total }));
    }
    if (['completed', 'failed', 'canceled'].includes(task.state)) {
      report.result = task;
      if (task.state !== 'completed') throw new Error(task.error || '设备任务未完成');
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (report.result?.state !== 'completed') throw new Error('真实语音测试超时');
  console.log('PASS: real provider -> PCM -> TaskService -> Wi-Fi upload -> device playback completed');
} catch (error) {
  report.error = /^(设备|提供商|火山|语音|真实|音频|合成|TTS|Speech|MiniMax)/.test(error.message) ? error.message : '测试连接失败，请检查本机网络与设备状态';
  console.error(report.error);
  process.exitCode = 1;
} finally {
  tasks.dispose();
  writeFileSync(join(destination, `m2-real-tts-${stamp}.json`), JSON.stringify(report, null, 2));
}
