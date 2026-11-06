import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SoundLibrary, wavFromPcm, readSoundWav, MAX_SOUND_BYTES } from '../core/sounds.js';
import { TaskService } from '../core/tasks.js';
import { createConfigStore } from '../host/config.js';
import { createPreview } from '../scripts/preview.mjs';
import { VoicePlayer } from '../client/player.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lease-sounds-'));
  const sounds = new SoundLibrary(directory); await sounds.ready;
  const pcm = Buffer.alloc(4800); for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(i % 4 ? -6000 : 6000, i);
  const first = await sounds.import('提示一.mp3', wavFromPcm(pcm));
  const secondPcm = Buffer.from(pcm); secondPcm.writeInt16LE(3000, 0);
  const second = await sounds.import('提示二', wavFromPcm(secondPcm));
  return { directory, sounds, pcm, first: first.item, second: second.item };
}
async function settled(tasks, id, client) {
  for (let n = 0; n < 200; n++) {
    const job = tasks.get(id, client);
    if (['ready', 'completed', 'failed', 'canceled'].includes(job.state)) return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('音频测试任务未完成');
}
test('提示音库按PCM去重、持久化元数据、音量缩放、只删除独立副本', async () => {
  const { directory, sounds, pcm, first } = await fixture();
  assert.equal((await sounds.import('不同文件名.wav', wavFromPcm(pcm))).duplicate, true);
  assert.equal(sounds.view().items.length, 2); assert.equal(first.seconds, 0.1);
  const reload = new SoundLibrary(directory); await reload.ready;
  assert.equal(reload.view().items[0].name, '提示一');
  const scaled = await reload.audio(first.id, 'esp32', 50);
  assert.equal(scaled.bytes.readInt16LE(0), 3000); assert.equal(scaled.format, 'pcm_s16le');
  const stored = await reload.audio(first.id); assert.deepEqual(readSoundWav(stored.bytes), pcm);
  await reload.remove(first.id); await assert.rejects(reload.audio(first.id), /不存在/);
  assert.equal(reload.view().items.length, 1);
});
test('拒绝伪装、截断、非24k单声道、过长文件及路径名；随机素材不紧邻重复', async () => {
  const { sounds, pcm, first, second } = await fixture();
  assert.throws(() => readSoundWav(Buffer.from('<html/>')), /WAV/);
  assert.throws(() => readSoundWav(wavFromPcm(pcm).subarray(0, 50)), /完整/);
  const wrong = wavFromPcm(pcm); wrong.writeUInt16LE(2, 22);
  assert.throws(() => readSoundWav(wrong), /单声道/);
  assert.throws(() => readSoundWav(Buffer.alloc(MAX_SOUND_BYTES + 1)), /60秒/);
  await assert.rejects(sounds.import('../leak.wav', wavFromPcm(pcm)), /名称/);
  await assert.rejects(sounds.audio('../config.json'), /不存在/);
  const one = sounds.pick([first.id, second.id]); const two = sounds.pick([first.id, second.id]);
  assert.notEqual(one, two); assert.equal(sounds.pick([first.id], 'selected'), first.id);
  assert.throws(() => sounds.pick(['missing']), /选择/);
});
test('随机/固定提示语音不调用TTS，设备和浏览器格式正确，手动指定试听不改配置', async t => {
  const { directory, sounds, first, second } = await fixture();
  const store = createConfigStore(directory); store.save({ completion: { enabled: true, sound: 'random', clipIds: [first.id, second.id], volume: 50 } });
  const calls = [], tasks = new TaskService(store, () => { throw new Error('不得调用TTS'); }, { sounds, play: async (_, audio) => calls.push(audio) });
  t.after(() => tasks.dispose());
  const firstTask = tasks.start({ chime: true, clientId: 'one' });
  assert.equal((await settled(tasks, firstTask.id, 'one')).state, 'ready');
  assert.equal(tasks.get(firstTask.id, 'one').segments[0].mime, 'audio/wav');
  store.save({ completion: { target: 'esp32' }, device: { endpoint: 'http://127.0.0.1:1' } });
  const onDevice = tasks.start({ chime: true, clipId: first.id, clientId: 'one' });
  await settled(tasks, onDevice.id, 'one');
  assert.equal(tasks.get(onDevice.id, 'one').state, 'completed');
  assert.equal(calls[0].bytes.readInt16LE(0), 3000); assert.equal(store.get().completion.sound, 'random');
});
test('音频接口真实上传/下载/删除与设备已完成PCM导出，按客户端隔离', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lease-sound-http-'));
  let synthesized = 0;
  const pcm = Buffer.alloc(4800, 1);
  const preview = await createPreview({ dataDir: directory, synth: async () => { synthesized++; return { bytes: pcm, mime: 'audio/pcm', format: 'pcm_s16le', channels: 1, sampleRate: 24000 }; } });
  t.after(() => preview.close()); const base = `${preview.url}/api/lease-voice`;
  const imported = await fetch(`${base}/sound-import`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Lease-Filename': encodeURIComponent('完成') }, body: wavFromPcm(pcm) });
  assert.equal(imported.status, 201); const item = (await imported.json()).item;
  const audio = await fetch(`${base}/sound-file?id=${item.id}`); assert.equal(audio.status, 200);
  assert.deepEqual(readSoundWav(Buffer.from(await audio.arrayBuffer())), pcm);
  preview.store.save({ outputTarget: 'esp32', device: { endpoint: 'http://127.0.0.1:1' } });
  preview.tasks.playDevice = async () => {};
  const task = preview.tasks.start({ text: 'hello', clientId: 'owner' });
  await new Promise(resolve => setImmediate(resolve));
  const exported = await fetch(`${base}/audio?id=${task.id}&clientId=owner&segment=0`);
  assert.equal(exported.status, 200); assert.equal(exported.headers.get('Content-Type'), 'audio/wav');
  assert.deepEqual(readSoundWav(Buffer.from(await exported.arrayBuffer())), pcm); assert.equal(synthesized, 1);
  assert.equal((await fetch(`${base}/audio?id=${task.id}&clientId=other&segment=0`)).status, 400);
  assert.equal((await fetch(`${base}/sound-file?id=${encodeURIComponent('../config.json')}`)).status, 400);
  assert.equal((await fetch(`${base}/sounds`, { method: 'POST', body: JSON.stringify({ action: 'remove', id: item.id }) })).status, 200);
  const data = JSON.parse(await readFile(join(directory, 'sounds.json'), 'utf8')); assert.equal(data.items.length, 0);
});
test('完成提示在等待队列中优先于正文，但不硬中断当前声音', () => {
  const queue = [{ automatic: true, messageId: 'old-speech' }];
  const player = { queue, current: { input: { messageId: 'playing' } }, notify: () => {} };
  VoicePlayer.prototype.enqueue.call(player, { automatic: true, chime: true, messageId: 'done' });
  VoicePlayer.prototype.enqueue.call(player, { automatic: true, messageId: 'new-speech' });
  assert.deepEqual(queue.map(x => x.messageId), ['done', 'old-speech', 'new-speech']);
  assert.equal(player.current.input.messageId, 'playing');
});
