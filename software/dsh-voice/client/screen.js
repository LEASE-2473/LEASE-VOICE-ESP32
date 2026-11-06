import { api, VoicePlayer } from './player.js';
import { ScreenPlayer } from './screen-player.js';
import { FrameSender } from './frame-sender.js';
import { SoundPanel } from './sounds.js';
const $ = id => document.getElementById(id);
const notice = (text, error = false) => { $('notice').textContent = text; $('notice').classList.toggle('error', error); };
const sourceNames = { pet: 'dsh-pet', meme: 'dsh-meme', local: '本地' };
let library, playlist = [], limit = 100, busy = false, dirty = false;
const screen = new ScreenPlayer($('screen-canvas'), (text, item) => { $('screen-status').textContent = text; $('screen-current').textContent = item?.name || '未选择素材'; });
const voice = new VoicePlayer(); voice.subscribe(text => { $('completion-status').textContent = text; });
const soundPanel = new SoundPanel(voice, notice, () => { completionDirty = true; }); soundPanel.bind();
const sender = new FrameSender($('screen-canvas'), voice.clientId, text => { $('screen-push-status').textContent = text; });
let displayDirty = false;
let backgroundState = { state: 'idle' }, backgroundTimer, leaving = false;
function renderBackground(value) {
  if (value.state === 'idle' && ['starting', 'running', 'paused', 'error'].includes(backgroundState.state)) $('screen-push-status').textContent = '后台播放已停止';
  backgroundState = value;
  if (value.state === 'idle') return;
  const states = { starting: '后台正在启动', running: '后台推送中', paused: '后台已暂停 · 保持最后画面', error: '后台推送失败' };
  $('screen-push-status').textContent = value.state === 'error' ? `${states.error}：${value.error}；请检查连接后重新开始` : `${states[value.state]} · 已接收 ${value.frames} 帧 · ${value.name || '正在载入'} · 上一帧 ${value.lastFrameMs}ms`;
}
async function pollBackground() {
  try { renderBackground(await api('screen-playback')); }
  catch (e) { $('screen-push-status').textContent = `后台状态不可用：${e.message}`; }
  finally { if (!leaving) backgroundTimer = setTimeout(pollBackground, 1000); }
}
async function controlBackground(action) {
  const result = await api('screen-playback', { action }); renderBackground(result);
  if (action === 'stop') $('screen-push-status').textContent = '设备画面已停止';
  return result;
}
function hardware() {
  return { profile: $('display-profile').value, xGap: Number($('display-x-gap').value), yGap: Number($('display-y-gap').value),
    swapXY: $('display-swap').checked, mirrorX: $('display-mirror-x').checked, mirrorY: $('display-mirror-y').checked,
    bgr: $('display-bgr').checked, invert: $('display-invert').checked };
}
function hardwareSize() {
  let [width, height] = { 'st7735-128x160': [128, 160], 'st7789-240x240': [240, 240], 'st7789-240x320': [240, 320] }[$('display-profile').value];
  if ($('display-swap').checked) [width, height] = [height, width];
  return [width, height];
}
async function push(pattern = false) {
  if (displayDirty) throw new Error('请先保存屏幕配置');
  const [width, height] = hardwareSize(), p = options();
  if (p.width !== width || p.height !== height) throw new Error('设备屏幕配置与模拟尺寸不一致，请调整模拟屏幕');
  await sender.stop();
  if (!pattern) {
    if (!selected().length) throw new Error('请先添加素材到播放列表');
    library = await api('media', { playlist, playback: p }); dirty = false;
    const result = await controlBackground('start');
    if (result.state === 'running') notice('后台播放已开始，离开或关闭本页仍继续。更改播放方案后请重新开始后台播放。');
    return;
  }
  await controlBackground('stop');
  if (pattern) {
    screen.configure([], p);
    const ctx = $('screen-canvas').getContext('2d');
    ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000'].forEach((color, i) => { ctx.fillStyle = color; ctx.fillRect(Math.floor(i * width / 5), 0, Math.ceil(width / 5), height); });
    $('screen-status').textContent = '测试色块 · 红绿蓝白黑';
  } else if (!screen.running) {
    if (!selected().length) throw new Error('请先添加素材或选择测试色块');
    play();
  }
  await sender.start(hardware());
}
function button(text, fn, label) {
  const el = document.createElement('button'); el.type = 'button'; el.textContent = text;
  if (label) el.setAttribute('aria-label', label);
  el.addEventListener('click', fn); return el;
}
function changed() { dirty = true; notice('播放方案有未保存的修改；可先预览，再保存。'); }
function options() {
  const [width, height] = $('screen-size').value.split('x').map(Number);
  return { width, height, order: $('screen-order').value, seconds: Number($('screen-seconds').value), fit: $('screen-fit').value, zoom: Number($('screen-zoom').value), background: $('screen-background').value };
}
function selected() { return playlist.map(id => library.items.find(x => x.id === id)).filter(Boolean); }
function play(items = selected()) { screen.configure(items, options()); screen.start(); }
function renderPlaylist() {
  $('playlist').replaceChildren(); $('playlist-count').textContent = playlist.length;
  $('playlist-empty').hidden = playlist.length > 0;
  for (const [index, id] of playlist.entries()) {
    const item = library.items.find(x => x.id === id), row = document.createElement('li'), title = document.createElement('span');
    title.textContent = item?.name || '素材已失效 · 请移出'; row.append(title);
    const actions = document.createElement('div'); actions.className = 'row-actions';
    const up = button('↑', () => { [playlist[index - 1], playlist[index]] = [playlist[index], playlist[index - 1]]; renderPlaylist(); changed(); }, `上移 ${title.textContent}`); up.disabled = index === 0;
    const down = button('↓', () => { [playlist[index + 1], playlist[index]] = [playlist[index], playlist[index + 1]]; renderPlaylist(); changed(); }, `下移 ${title.textContent}`); down.disabled = index === playlist.length - 1;
    actions.append(up, down, button('移出', () => { playlist.splice(index, 1); renderPlaylist(); renderLibrary(); changed(); }, `移出 ${title.textContent}`)); row.append(actions); $('playlist').append(row);
  }
}
function renderLibrary() {
  const filter = $('media-source').value, search = $('media-search').value.trim().toLocaleLowerCase();
  const items = library.items.filter(x => (filter === 'all' || x.source === filter) && x.name.toLocaleLowerCase().includes(search));
  $('media-count').textContent = `${items.length} 项符合筛选 · 素材库共 ${library.items.length} 项`;
  $('media-list').replaceChildren(); $('media-more').hidden = items.length <= limit;
  for (const item of items.slice(0, limit)) {
    const row = document.createElement('div'); row.className = 'media-row';
    const description = document.createElement('div'), name = document.createElement('strong'), hint = document.createElement('small');
    name.textContent = item.name; hint.textContent = `${sourceNames[item.source]} · ${item.kind === 'video' ? '视频' : '图片 / 动图'} · ${(item.bytes / 1024).toFixed(0)} KiB`;
    description.append(name, hint); row.append(description);
    const actions = document.createElement('div'); actions.className = 'row-actions';
    actions.append(button('预览', () => play([item]), `预览 ${item.name}`));
    const add = button(playlist.includes(item.id) ? '已添加' : '添加', () => { if (playlist.length >= 300) { notice('播放列表最多 300 项', true); return; } playlist.push(item.id); renderPlaylist(); renderLibrary(); changed(); }, `添加 ${item.name}`);
    add.disabled = playlist.includes(item.id); actions.append(add);
    if (item.source === 'local') actions.append(button('删除文件', () => {
      if (confirm(`删除本地导入文件“${item.name}”？此操作同时移出播放列表。`)) void operate(async () => { library = await api('media', { action: 'remove', id: item.id }); playlist = playlist.filter(x => x !== item.id); screen.stop(); renderPlaylist(); renderLibrary(); notice('已删除本地导入文件。'); });
    }, `删除 ${item.name}`));
    row.append(actions); $('media-list').append(row);
  }
  if (!items.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = '没有找到素材。可以导入本地文件，或检查素材目录设置。'; $('media-list').append(p); }
}
async function operate(fn) {
  if (busy) return; busy = true;
  const controls = [...document.querySelectorAll('button,input,select')];
  const states = controls.map(x => x.disabled);
  controls.forEach(x => { if (!['screen-stop', 'completion-stop', 'screen-push-stop'].includes(x.id)) x.disabled = true; });
  try { await fn(); } catch (e) { notice(e.message, true); }
  finally { busy = false; controls.forEach((x, i) => { if (x.isConnected) x.disabled = states[i]; }); }
}
function renderSettings() {
  const p = library.playback;
  $('screen-size').value = `${p.width}x${p.height}`; $('screen-order').value = p.order; $('screen-seconds').value = p.seconds; $('screen-fit').value = p.fit; $('screen-background').value = p.background;
  $('screen-zoom').value = p.zoom ?? 1;
  $('pet-root').value = library.roots.pet; $('meme-root').value = library.roots.meme;
  const d = library.display || {};
  $('display-profile').value = d.profile || 'st7735-128x160'; $('display-x-gap').value = d.xGap || 0; $('display-y-gap').value = d.yGap || 0;
  for (const [id, key] of [['display-swap', 'swapXY'], ['display-mirror-x', 'mirrorX'], ['display-mirror-y', 'mirrorY'], ['display-bgr', 'bgr'], ['display-invert', 'invert']]) $(id).checked = !!d[key];
  screen.configure(selected(), p); renderPlaylist(); renderLibrary();
}
const matchesPreview = () => JSON.stringify(screen.items.map(x => x.id)) === JSON.stringify(selected().map(x => x.id)) && Object.entries(options()).every(([key, value]) => screen.options[key] === value);
$('screen-start').addEventListener('click', () => { if (screen.running && screen.paused && matchesPreview()) screen.start(); else play(); });
$('screen-pause').addEventListener('click', () => screen.pause());
$('screen-next').addEventListener('click', () => { if (!screen.items.length || !matchesPreview()) play(); else screen.next(); });
$('screen-stop').addEventListener('click', () => screen.stop());
$('screen-form').addEventListener('input', changed);
$('screen-form').addEventListener('submit', e => { e.preventDefault(); void operate(async () => {
  library = await api('media', { playlist, playback: options() }); dirty = false; notice('播放方案已保存。下次开始循环时使用这些设置。');
}); });
$('playlist-clear').addEventListener('click', () => { playlist = []; screen.stop(); renderPlaylist(); renderLibrary(); changed(); });
for (const id of ['media-source', 'media-search']) $(id).addEventListener('input', () => { limit = 100; renderLibrary(); });
$('media-more').addEventListener('click', () => { limit += 100; renderLibrary(); });
$('media-refresh').addEventListener('click', () => void operate(async () => {
  library = await api('media', { action: 'scan' }); renderPlaylist(); renderLibrary(); notice(`素材库已刷新。${library.warnings.join(' ')}`);
}));
$('source-form').addEventListener('submit', e => { e.preventDefault(); void operate(async () => {
  library = await api('media', { roots: { pet: $('pet-root').value, meme: $('meme-root').value } }); renderPlaylist(); renderLibrary(); notice(`目录已保存并扫描。${library.warnings.join(' ')}`);
}); });
$('media-upload').addEventListener('change', e => { const files = [...e.target.files]; void operate(async () => {
  let imported = 0; const errors = [];
  for (const file of files) {
    if (file.size > 32 * 1024 * 1024) { errors.push(`${file.name} 超过 32MiB`); continue; }
    notice(`正在导入 ${file.name}…`);
    try {
      const response = await fetch('/api/lease-voice/media-import', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', 'X-Lease-Filename': encodeURIComponent(file.name) }, body: file });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || '导入失败'); library = result; imported++;
    } catch (error) { errors.push(`${file.name}：${error.message}`); }
  }
  e.target.value = ''; renderLibrary(); notice(`已导入 ${imported} 个文件。${errors.join('；')}`, errors.length > 0);
}); });
let completionDirty = false;
$('completion-form').addEventListener('input', () => { completionDirty = true; $('completion-volume-value').textContent = `${$('completion-volume').value}%`; });
$('completion-form').addEventListener('submit', e => { e.preventDefault(); void operate(async () => {
  await api('config', { completion: { enabled: $('completion-enabled').checked, target: $('completion-target').value, volume: Number($('completion-volume').value), sound: $('completion-sound').value, clipIds: soundPanel.selected() } }); completionDirty = false; notice('完成提示设置已保存。');
}); });
$('completion-test').addEventListener('click', () => { if (completionDirty) { notice('请先保存提示设置再试听。', true); return; } voice.enqueue({ chime: true }); });
$('completion-stop').addEventListener('click', () => voice.stop());
$('display-form').addEventListener('input', () => { displayDirty = true; });
for (const id of ['display-profile', 'display-swap']) $(id).addEventListener('change', () => {
  const [width, height] = hardwareSize();
  if ([...$('screen-size').options].some(x => x.value === `${width}x${height}`)) { $('screen-size').value = `${width}x${height}`; changed(); }
});
$('display-form').addEventListener('submit', e => { e.preventDefault(); void operate(async () => {
  if (sender.stream || ['starting', 'running', 'paused'].includes((await api('screen-playback')).state)) throw new Error('请先停止设备画面再保存屏幕配置');
  library = await api('media', { display: hardware() }); displayDirty = false; notice('屏幕配置已保存；尚未启用设备屏幕。');
}); });
$('screen-push-start').addEventListener('click', () => void operate(() => push()));
$('screen-push-pattern').addEventListener('click', () => void operate(() => push(true)));
$('screen-push-stop').addEventListener('click', () => void (async () => {
  try { await sender.stop(); await controlBackground('stop'); } catch (e) { notice(e.message, true); }
})());
for (const action of ['pause', 'resume', 'next']) $('background-' + action).addEventListener('click', () => void operate(() => controlBackground(action)));
$('screen-device-check').addEventListener('click', () => void operate(async () => {
  const result = await api('screen-control'); $('screen-device-info').hidden = false; $('screen-device-info').textContent = JSON.stringify(result, null, 2);
  notice('设备支持画面接收；屏幕实际效果仍需现场确认。');
}));
window.addEventListener('beforeunload', e => { if (dirty || completionDirty || displayDirty) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('pagehide', () => { leaving = true; clearTimeout(backgroundTimer); sender.pagehide(); screen.stop(); voice.dispose(); });
window.addEventListener('pageshow', e => { if (e.persisted) { leaving = false; void pollBackground(); } });
async function load() {
  const [data, config] = await Promise.all([api('media'), api('config')]);
  library = data; playlist = [...library.playlist]; renderSettings();
  $('completion-enabled').checked = config.completion?.enabled || false;
  $('completion-target').value = config.completion?.target || 'browser';
  $('completion-volume').value = config.completion?.volume ?? 35; $('completion-volume-value').textContent = `${$('completion-volume').value}%`;
  await soundPanel.load(config);
  if (config.preview) $('environment').textContent = '隔离预览';
  notice(`素材库已读取，共 ${library.items.length} 项。${library.warnings.join(' ')}`);
  void pollBackground();
}
void operate(load);
