import test from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundScreen } from '../core/screen-background.js';

const wait = async predicate => { for (let n = 0; n < 300; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('等待状态超时'); };
function fixture({ fail = false, gate } = {}) {
  const stats = { frames: 0, closed: 0, stopped: 0, commands: [], active: 0, maxActive: 0 };
  const library = { playlist: ['one'], items: [{ id: 'one', name: '测试图片' }], display: {}, playback: { width: 128, height: 160 } };
  const media = { ready: Promise.resolve(), view: () => structuredClone(library) };
  const display = {
    start: async () => ({ streamId: 'test' }),
    frame: async () => { stats.active++; stats.maxActive = Math.max(stats.maxActive, stats.active); await new Promise(resolve => setTimeout(resolve, 30)); stats.active--; if (fail === true || (typeof fail === 'function' && fail(stats.frames))) throw Error('模拟断网'); stats.frames++; },
    stop: async () => { stats.stopped++; },
  };
  const screen = new BackgroundScreen(media, display, { renderer: () => ({
    open: async () => { if (gate) await gate; }, frame: async () => ({ bytes: Buffer.alloc(40960), name: '测试图片' }),
    command: async action => stats.commands.push(action), close: async () => { stats.closed++; },
  }) });
  return { screen, library, stats };
}
test('后台循环无需页面心跳，单帧背压；暂停继续/下一个和停止释放资源', async () => {
  const { screen, stats } = fixture();
  try {
    await screen.start(); await wait(() => stats.frames >= 3);
    assert.equal(screen.view().name, '测试图片'); assert.equal(stats.maxActive, 1);
    assert.equal((await screen.command('pause')).state, 'paused');
    await wait(() => stats.frames >= 4); // 暂停仍发送最后画面，避免固件断流。
    assert.equal((await screen.command('resume')).state, 'running'); await screen.command('next');
    assert.deepEqual(stats.commands, ['pause', 'resume', 'next']);
    await screen.stop(); const before = stats.frames;
    await new Promise(resolve => setTimeout(resolve, 250)); assert.equal(stats.frames, before);
    assert.equal(stats.closed, 1); assert.equal(stats.stopped, 1); assert.equal(screen.view().state, 'idle');
  } finally { await screen.dispose(); }
});
test('首帧发送失败不会死锁，释放播放器/设备流并显示可重试错误', async () => {
  const { screen, stats } = fixture({ fail: true });
  await assert.rejects(screen.start(), /模拟断网/); assert.equal(screen.view().state, 'error');
  await screen.chain; assert.equal(stats.closed, 1); assert.equal(stats.stopped, 1);
  await screen.stop(); assert.equal(screen.view().state, 'idle');
});
test('启动期间停止不会留下迟到播放器或设备流；可重新开始', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const { screen, stats } = fixture({ gate });
  const start = screen.start(); await wait(() => screen.view().state === 'starting');
  const stop = screen.stop(); release(); await start; await stop;
  assert.equal(screen.view().state, 'idle'); assert.equal(stats.frames, 0); assert.equal(stats.closed, 1);
  await screen.start(); assert.equal(stats.frames, 1); await screen.dispose(); assert.equal(stats.closed, 2);
});
test('运行中断网释放资源且停止计数，不无限重试或积压帧', async () => {
  const { screen, stats } = fixture({ fail: frames => frames >= 1 });
  await screen.start(); await wait(() => screen.view().state === 'error'); await screen.chain;
  assert.equal(screen.current, null); assert.equal(stats.closed, 1); assert.equal(stats.stopped, 1);
  assert.equal(screen.view().frames, 1); await screen.stop();
});
test('启动拒绝空/失效列表或不匹配的尺寸；非法操作不启动播放器', async () => {
  const { screen, library, stats } = fixture();
  library.playlist = []; await assert.rejects(screen.start(), /播放列表/);
  library.playlist = ['missing']; await assert.rejects(screen.start(), /播放列表/);
  library.playlist = ['one']; library.playback.width = 160; await assert.rejects(screen.start(), /尺寸/);
  await assert.rejects(screen.command('unknown'), /操作无效/); assert.equal(stats.closed, 0);
});
