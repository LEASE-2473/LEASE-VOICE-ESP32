import { SoundPanel } from './sounds.js';
import { api, VoicePlayer } from './player.js';
import { taskWav, importSound, downloadWav } from './audio-tools.js';

const $ = id => document.getElementById(id);
let config;
let busy = false;
let dirty = false;
let deviceDirty = false;
const volcEndpoints = { websocket: 'wss://openspeech.bytedance.com/api/v3/tts/bidirection', sse: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse' };
const player = new VoicePlayer();
const configuration = new URLSearchParams(location.search).get('tab') === 'config';
const extension = location.pathname.endsWith('/extensions');
$('voice-page').hidden = extension;
$('extension-page').hidden = !extension;
$(extension ? 'extension-nav' : configuration ? 'config-nav' : 'voice-nav').classList.add('active');
$('page-title').textContent = extension ? '语音扩展' : '让回复，有声音。';
document.title = `LEASE VOICE · ${extension ? '扩展' : '语音'}`;
const notice = (message, error = false) => { $('notice').textContent = message; $('notice').classList.toggle('error', error); };
player.subscribe(status => { $('play-status').textContent = status; });

function renderProvider() {
  const id = $('provider').value;
  const p = config.providers[id];
  const volc = id === 'volcengine';
  for (const [input, key] of Object.entries({ endpoint: 'endpoint', model: 'model', voice: 'voice', 'resource-id': 'resourceId', 'app-id': 'appId', 'auth-mode': 'authMode', speed: 'speed' })) $(input).value = p[key];
  for (const field of ['api-key', 'access-token']) $(field).value = '';
  $('clear-key').checked = false; $('clear-token').checked = false;
  $('auth-field').hidden = !volc; $('resource-field').hidden = !volc; $('transport-field').hidden = !volc;
  $('transport').value = p.transport || (/^wss?:/.test(p.endpoint) ? 'websocket' : 'sse');
  $('model-label').textContent = volc ? '复刻模型 ID（可选）' : '模型 ID';
  $('model').placeholder = volc ? '普通音色留空；复刻音色按控制台填写' : '填写已开通的 TTS 模型 ID';
  $('key-state').textContent = p.apiKeySet ? '已保存 API Key；留空不修改。' : '尚未保存 API Key。';
  $('token-state').textContent = p.accessTokenSet ? '已保存 Access Token；留空不修改。' : '尚未保存 Access Token。';
  if (!volc) $('provider-note').textContent = id === 'minimax' ? '使用 MiniMax 同步 HTTP 协议，读取 hex 音频。模型和音色请按账号已开通的服务填写。' : '适用于支持 POST /audio/speech 并直接返回音频的服务。填写完整 endpoint；“聊天 API 兼容”不代表支持语音合成。';
  renderTransport();
  const range = volc ? [-50, 100, 1] : id === 'minimax' ? [0.5, 2, 0.05] : [0.25, 4, 0.05];
  $('speed').min = range[0]; $('speed').max = range[1]; $('speed').step = range[2];
  $('speed-label').textContent = volc ? '语速偏移' : '语速倍率';
  $('speed-hint').textContent = volc ? '整数 -50 至 100，0 为正常语速。' : `范围 ${range[0]} 至 ${range[1]}，1 为正常语速。`;
  renderAuth();
}
function renderTransport() {
  if ($('provider').value !== 'volcengine') return;
  $('provider-note').textContent = $('transport').value === 'websocket'
    ? '使用官方双向 WebSocket 二进制协议。新版填语音 API Key；旧版填 App ID 与 Access Token。Resource ID 对应模型版本，音色 ID 对应具体声音。朗读仍在回复完成后开始，不添加语音指令。'
    : 'HTTP SSE 是另一套单向接口，不能填写 wss 地址。新版/旧版凭据按控制台选择；合成结束后播放。';
}
function renderAuth() {
  const legacy = $('provider').value === 'volcengine' && $('auth-mode').value === 'legacy';
  $('legacy-fields').hidden = !legacy;
  $('key-field').hidden = legacy;
}
const soundPanel = new SoundPanel(player, notice, () => {}); soundPanel.bind();
$('provider-card').hidden = !configuration;
$('sample-card').hidden = !configuration;
$('mode-card').hidden = configuration;
$('completion-form').closest('section').hidden = extension || configuration;
function deviceOptions(ok, capabilities = []) {
  for (const id of ['output-target', 'completion-target']) {
    const select = $(id), option = select.querySelector('option[value=esp32]');
    option.hidden = !ok; option.disabled = !ok;
    if (!ok) select.value = 'browser';
  }
  if (ok) { $('output-target').value = config.outputTarget || 'browser'; $('completion-target').value = config.completion?.target || 'browser'; }
  const displayReady = capabilities.includes('display-rgb565') && capabilities.includes('display-config');
  $('display-availability').textContent = displayReady
    ? '已连接支持屏幕接收的设备。打开画面页，检查屏幕能力后可推送测试色块、素材和后台动画。'
    : ok ? '设备音频已连接，但未声明完整屏幕接收能力；可管理素材和预览，实体推送需要配套 M3 固件。'
    : '尚未连接或检查未通过：可先打开画面管理、导入素材和预览；实体推送前请在下方保存设备并连接检查。';
}
async function load() {
  config = await api('config');
  document.querySelector(`input[name=mode][value=${config.mode}]`).checked = true;
  $('output-target').value = config.outputTarget || 'browser';
  $('output-target').querySelector('option[value=esp32]').disabled = config.deviceAudioProtocolVersion !== 1;
  $('provider').value = config.activeProvider;
  renderProvider();
  $('profiles').replaceChildren(...Object.keys(config.profiles || {}).map(name => new Option(name, name)));
  $('completion-enabled').checked = config.completion?.enabled || false;
  $('completion-target').value = config.completion?.target || 'browser';
  $('completion-volume').value = config.completion?.volume ?? 35;
  await soundPanel.load(config);
  deviceOptions(false);
  if (config.device.endpoint && config.device.tokenSet) {
    try { const info = await api('device-debug', { action: 'info' }); deviceOptions(info.capabilities.includes('audio-pcm16'), info.capabilities); } catch {}
  }
  $('device-name').value = config.device.name;
  $('device-endpoint').value = config.device.endpoint;
  $('device-token').value = ''; $('clear-device-token').checked = false;
  $('device-token-state').textContent = config.device.tokenSet ? '设备凭据已保存；留空不修改。' : '尚未保存设备凭据。';
  if (config.preview) $('environment').textContent = '隔离预览 · 模拟音频';
  const backendReady = config.ttsProtocolVersion === 2;
  $('voice-form').inert = !backendReady;
  $('listen').disabled = !backendReady;
  notice(backendReady ? `配置已读取。${config.migrationNotice || ''}${config.deviceAudioProtocolVersion === 1 ? '' : '设备输出需要重载新版语音插件后端。'}` : '界面已更新，DSH 语音后端仍是旧版。请重载语音插件，再配置 WebSocket。', !backendReady);
  dirty = false; deviceDirty = false;
}
async function operate(fn) {
  if (busy) return;
  busy = true;
  const buttons = [...document.querySelectorAll('button')].filter(button => !['stop', 'enable'].includes(button.id));
  for (const button of buttons) button.disabled = true;
  try { await fn(); } catch (error) { notice(error.message, true); }
  finally { busy = false; for (const button of buttons) button.disabled = false; }
}
$('provider').addEventListener('change', () => {
  renderProvider(); dirty = true;
  notice('已切换配置档；点击保存后才会用于朗读。未保存的上一档修改不会保留。');
});
$('auth-mode').addEventListener('change', renderAuth);
$('transport').addEventListener('change', () => { $('endpoint').value = volcEndpoints[$('transport').value]; dirty = true; renderTransport(); });
$('voice-form').addEventListener('input', e => { if (!['profile-name', 'profiles'].includes(e.target.id)) dirty = true; });
$('voice-form').addEventListener('submit', event => {
  event.preventDefault();
  void operate(async () => {
    const provider = { id: $('provider').value, ...($('provider').value === 'volcengine' ? { transport: $('transport').value } : {}), endpoint: $('endpoint').value, model: $('model').value, voice: $('voice').value, resourceId: $('resource-id').value, appId: $('app-id').value, authMode: $('auth-mode').value, speed: Number($('speed').value), apiKey: $('api-key').value, accessToken: $('access-token').value, clearApiKey: $('clear-key').checked, clearAccessToken: $('clear-token').checked };
    await api('config', { mode: document.querySelector('input[name=mode]:checked').value, outputTarget: $('output-target').value, activeProvider: provider.id, provider });
    player.stop(); await load(); notice('语音设置已保存，下一次朗读使用新配置。');
  });
});
$('reload').addEventListener('click', () => void operate(load));
$('listen').addEventListener('click', () => {
  if (dirty) { notice('请先保存语音设置再试听。', true); return; }
  player.enqueue({ text: $('sample').value });
});
$('enable').addEventListener('click', () => void player.enable());
$('stop').addEventListener('click', () => player.stop());
$('save-audio').addEventListener('click', () => void operate(async () => {
  await importSound($('audio-save-name').value, await taskWav(player, 60)); notice('合成音频已保存到电脑提示素材库，可在屏幕播放页选择。');
}));
$('download-audio').addEventListener('click', () => void operate(async () => {
  downloadWav(await taskWav(player), $('audio-save-name').value); notice('已生成WAV下载，不会重新调用TTS。');
}));
$('device-form').addEventListener('input', () => { deviceDirty = true; deviceOptions(false); $('connection-state').textContent = '设备配置已修改，保存后重新检查连接'; $('device-info').replaceChildren(); });
$('device-form').addEventListener('submit', event => {
  event.preventDefault();
  void operate(async () => {
    await api('config', { device: { name: $('device-name').value, endpoint: $('device-endpoint').value, token: $('device-token').value, clearToken: $('clear-device-token').checked } });
    await load(); $('connection-state').textContent = '配置已保存，尚未检查连接'; notice('设备配置已保存。');
  });
});
async function debug(action, value) {
  if (deviceDirty) throw new Error('请先保存设备配置，再连接或调试');
  $('connection-state').textContent = action === 'info' ? '正在连接设备…' : '正在发送调试命令…';
  const at = new Date().toLocaleTimeString('zh-CN');
  try {
    const result = await api('device-debug', { action, value });
    $('connection-state').textContent = action === 'info' ? '已连接 · 协议 v1' : '设备已接受命令；请观察实物';
    $('debug-log').textContent = `[${at}] ${action}\n${JSON.stringify(result, null, 2)}`;
    if (action === 'info') {
      deviceOptions(result.capabilities.includes('audio-pcm16'), result.capabilities);
      $('device-info').replaceChildren();
      for (const [label, value] of [['名称', result.name], ['固件版本', result.firmware], ['能力', result.capabilities.join('、') || '未声明']]) {
        const dt = document.createElement('dt'); dt.textContent = label;
        const dd = document.createElement('dd'); dd.textContent = value || '未提供';
        $('device-info').append(dt, dd);
      }
    }
    notice('调试操作完成。');
  } catch (error) {
    deviceOptions(false);
    $('connection-state').textContent = '连接或命令失败'; $('device-info').replaceChildren();
    $('debug-log').textContent = `[${at}] ${action}\n${error.message}`;
    throw error;
  }
}
$('connect').addEventListener('click', () => void operate(() => debug('info')));
$('disconnect').addEventListener('click', () => void operate(async () => {
  await api('config', { device: { endpoint: '', clearToken: true } });
  await load(); $('connection-state').textContent = '已移除设备地址与凭据'; $('device-info').replaceChildren(); notice('连接配置已移除。');
}));
$('device-volume').addEventListener('input', () => { $('volume-value').textContent = `${$('device-volume').value}%`; });
$('set-volume').addEventListener('click', () => void operate(() => debug('volume', Number($('device-volume').value))));
$('test-tone').addEventListener('click', () => void operate(() => debug('test-tone')));
$('device-stop').addEventListener('click', () => void operate(() => debug('stop')));
window.addEventListener('pagehide', () => player.dispose());
void load().catch(error => notice(error.message, true));

$('save-mode').addEventListener('click', () => void operate(async () => { await api('config', { mode: document.querySelector('input[name=mode]:checked').value }); dirty = false; notice('朗读方式已保存'); }));
$('save-output').addEventListener('click', () => void operate(async () => { await api('config', { outputTarget: $('output-target').value, completion: { target: $('output-target').value } }); notice('播放设备已保存'); }));
for (const action of ['save', 'select', 'delete']) $('profile-' + action).addEventListener('click', () => void operate(async () => {
  if (action === 'save' && dirty) throw new Error('请先保存语音设置，再保存为配置档');
  await api('config', { profile: { action, name: action === 'save' ? $('profile-name').value : $('profiles').value } }); await load(); notice('配置档已更新');
}));
$('completion-form').addEventListener('input', () => { $('completion-volume-value').textContent = $('completion-volume').value + '%'; });
$('completion-form').addEventListener('submit', e => { e.preventDefault(); void operate(async () => {
  await api('config', { completion: { enabled: $('completion-enabled').checked, target: $('completion-target').value, volume: Number($('completion-volume').value), sound: $('completion-sound').value, clipIds: soundPanel.selected() } }); notice('提示设置已保存');
}); });
$('completion-test').addEventListener('click', () => player.enqueue({ chime: true }));
$('completion-stop').addEventListener('click', () => player.stop());

$('pairing-import').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    if (file.size > 16384) throw new Error();
    const record = JSON.parse(await file.text());
    if (!record || Array.isArray(record) || Object.keys(record).sort().join(',') !== 'endpoint,name,token') throw new Error();
    if (typeof record.name !== 'string' || record.name.length > 100 || !record.name.trim() ||
        typeof record.token !== 'string' || !record.token || record.token.length > 4096 || /[\r\n\0]/.test(record.token) ||
        typeof record.endpoint !== 'string') throw new Error();
    const endpoint = new URL(record.endpoint);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw new Error();
    $('device-name').value = record.name;
    $('device-endpoint').value = endpoint.origin;
    $('device-token').value = record.token;
    $('clear-device-token').checked = false;
    deviceDirty = true; deviceOptions(false);
    $('device-info').replaceChildren();
    $('connection-state').textContent = '配对文件已填入，尚未保存或检查';
    notice('请核对设备地址后保存设备，再点击连接检查。配对Token不会显示在通知或日志中。');
  } catch { notice('配对文件无效：需要仅包含 name、endpoint、token 的JSON对象。', true); }
});
