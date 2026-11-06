import test from 'node:test';
import assert from 'node:assert/strict';
import { playDeviceAudio } from '../extensions/device-audio.js';
import { TaskService } from '../core/tasks.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, updateConfig, createConfigStore } from '../host/config.js';

const pcm = () => ({ bytes: Buffer.alloc(480), mime: 'audio/pcm', sampleRate: 24000, channels: 1, format: 'pcm_s16le' });
const device = { endpoint: 'http://192.168.1.50', token: 'local-token' };
const info = () => Response.json({ protocol: 1, kind: 'lease-voice-esp32', capabilities: ['audio-pcm16', 'playback-status'] });
async function settled(job) {
  for (let n = 0; n < 200 && !['ready', 'completed', 'failed', 'canceled'].includes(job.state); n++) await new Promise(r => setTimeout(r, 5));
  return job;
}
test('设备 PCM 传输鉴权、格式与终态轮询，上传接受不等于播放结束', async () => {
  const states = [];
  let polls = 0, uploads = 0;
  await playDeviceAudio(device, pcm(), { id: 'job-1', pollMs: 0, onState: s => states.push(s), fetchImpl: async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer local-token');
    assert.equal(init.redirect, 'error');
    if (url.endsWith('/info')) return info();
    if (url.endsWith('/audio')) {
      uploads++; assert.equal(init.headers['X-Lease-Sample-Rate'], '24000');
      assert.equal(init.headers['X-Lease-Audio-Id'], 'job-1'); assert.equal(init.body.length, 480);
      return Response.json({ protocol: 1, ok: true, id: 'job-1', state: 'queued' }, { status: 202 });
    }
    polls++; return Response.json({ protocol: 1, id: 'job-1', state: polls === 1 ? 'playing' : 'completed' });
  } });
  assert.equal(uploads, 1); assert.equal(polls, 2); assert.deepEqual(states, ['sending', 'playing']);
});
test('设备 PCM 拒绝 MP3、旧固件，并在取消时按 id 停止而不误停其他任务', async () => {
  await assert.rejects(playDeviceAudio(device, { bytes: Buffer.from('mp3') }, { id: 'x' }), /PCM16/);
  await assert.rejects(playDeviceAudio(device, pcm(), { id: 'x', fetchImpl: async () => Response.json({ protocol: 1, kind: 'lease-voice-esp32', capabilities: [] }) }), /M2/);
  const controller = new AbortController();
  const commands = [];
  await assert.rejects(playDeviceAudio(device, pcm(), { id: 'old-task', signal: controller.signal, pollMs: 0, fetchImpl: async (url, init) => {
    if (url.endsWith('/info')) return info();
    if (url.endsWith('/audio')) {
      setTimeout(() => controller.abort(), 2);
      return Response.json({ protocol: 1, ok: true, id: 'old-task', state: 'playing' });
    }
    if (url.endsWith('/command')) { commands.push(JSON.parse(init.body)); return Response.json({ protocol: 1, ok: true }); }
    return Response.json({ protocol: 1, id: 'old-task', state: 'playing' });
  } }));
  assert.deepEqual(commands, [{ protocol: 1, action: 'stop', id: 'old-task' }]);
});
test('设备目标分段串行播放且缓存重播，浏览器缓存与硬件隔离', async () => {
  let config = updateConfig(defaultConfig(), { outputTarget: 'esp32', device });
  let synths = 0, active = 0, maximum = 0;
  const ids = [];
  const tasks = new TaskService({ get: () => config }, async (provider, text) => {
    assert.equal(provider.audioFormat, 'pcm'); assert.equal(provider.sampleRate, 24000);
    assert.ok(Array.from(text).length <= 200); synths++; return pcm();
  }, { play: async (d, audio, options) => {
    assert.equal(d.token, device.token); options.onState('playing'); ids.push(options.id);
    active++; maximum = Math.max(maximum, active); await new Promise(r => setTimeout(r, 2)); active--;
  } });
  const text = '测'.repeat(201);
  const first = tasks.start({ text, clientId: 'a' });
  const job = await settled(tasks.get(first.id, 'a'));
  assert.equal(job.state, 'completed'); assert.equal(job.completed, 2); assert.equal(maximum, 1); assert.equal(synths, 2);
  assert.equal(JSON.stringify(tasks.view(job)).includes(device.token), false);
  const second = tasks.start({ text, clientId: 'a' });
  assert.notEqual(second.id, first.id); await settled(tasks.get(second.id, 'a'));
  assert.equal(synths, 2); assert.equal(ids.length, 4); assert.notEqual(ids[0], ids[2]);
  config = { ...config, outputTarget: 'browser' };
  assert.throws(() => updateConfig(config, { outputTarget: 'invalid' }), /目标/);
  tasks.dispose();
});

 test('播放目标持久化，设备后端版本标志与凭据脱敏', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lease-target-'));
  const store = createConfigStore(dir);
  const view = store.save({ outputTarget: 'esp32', device });
  assert.equal(view.outputTarget, 'esp32'); assert.equal(view.deviceAudioProtocolVersion, 1);
  assert.equal(JSON.stringify(view).includes(device.token), false);
  assert.equal(createConfigStore(dir).get().outputTarget, 'esp32');
 });
