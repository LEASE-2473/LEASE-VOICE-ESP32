import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readMessage } from '../core/replies.js';
import { debugDevice } from '../extensions/esp32.js';
import { MAX_MEDIA_BYTES } from '../core/media-library.js';
import { MAX_FRAME_BYTES } from '../extensions/display.js';
import { MAX_SOUND_BYTES, wavFromPcm } from '../core/sounds.js';

export const PREFIX = '/api/lease-voice';
export const ROUTES = ['ui', 'extensions', 'screen', 'ui.js', 'ui.css', 'player.js', 'screen.js', 'screen-player.js', 'frame-sender.js', 'audio-tools.js', 'sounds.js', 'sounds', 'sound-file', 'sound-import', 'screen-playback', 'screen-control', 'screen-frame', 'config', 'synthesize', 'task', 'audio', 'cancel', 'lease', 'events', 'device-debug', 'media', 'media-file', 'media-import'];
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const id = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{1,180}$/.test(value)) throw new Error('请求身份无效');
  return value;
};
async function body(request) {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 65536) throw new Error('请求内容过长');
  try { return JSON.parse(raw); } catch { throw new Error('请求 JSON 无效'); }
}
export function createHandler({ store, tasks, replies, media, display, sounds, background, getSession, deviceFetch, preview = false }) {
  const assets = new Map([
    ['ui', ['index.html', 'text/html; charset=utf-8']], ['extensions', ['index.html', 'text/html; charset=utf-8']],
    ['ui.js', ['ui.js', 'text/javascript; charset=utf-8']], ['ui.css', ['ui.css', 'text/css; charset=utf-8']], ['player.js', ['player.js', 'text/javascript; charset=utf-8']],
    ['screen', ['screen.html', 'text/html; charset=utf-8']], ['screen.js', ['screen.js', 'text/javascript; charset=utf-8']], ['screen-player.js', ['screen-player.js', 'text/javascript; charset=utf-8']],
    ['frame-sender.js', ['frame-sender.js', 'text/javascript; charset=utf-8']],
    ['audio-tools.js', ['audio-tools.js', 'text/javascript; charset=utf-8']], ['sounds.js', ['sounds.js', 'text/javascript; charset=utf-8']],
  ]);
  return async request => {
    try {
      const url = new URL(request.url);
      const name = url.pathname.slice(PREFIX.length + 1);
      if (request.method === 'GET' && assets.has(name)) {
        const [file, mime] = assets.get(name);
        return new Response(readFileSync(new URL(`../client/${file}`, import.meta.url)), { headers: { 'Content-Type': mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'" } });
      }
      if (['sounds', 'sound-file', 'sound-import'].includes(name)) {
        if (!sounds) return json({ error: '音频素材库尚未加载' }, 503);
        await sounds.ready;
        if (name === 'sounds' && request.method === 'GET') return json(sounds.view());
        if (name === 'sounds' && request.method === 'POST') {
          const input = await body(request);
          if (input.action !== 'remove') throw new Error('音频素材操作无效');
          return json(await sounds.remove(input.id));
        }
        if (name === 'sound-file' && request.method === 'GET') {
          const audio = await sounds.audio(url.searchParams.get('id'));
          return new Response(audio.bytes, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
        }
        if (name === 'sound-import' && request.method === 'POST') {
          if (request.headers.get('Content-Type') !== 'audio/wav') throw new Error('音频素材请先转换为 WAV');
          const chunks = []; let count = 0;
          for await (const chunk of request.body || []) {
            count += chunk.byteLength;
            if (count > MAX_SOUND_BYTES) return json({ error: '音频提示素材最长60秒' }, 413);
            chunks.push(Buffer.from(chunk));
          }
          return json(await sounds.import(decodeURIComponent(request.headers.get('X-Lease-Filename') || ''), Buffer.concat(chunks)), 201);
        }
      }
      if (name === 'screen-playback') {
        if (!background) return json({ error: '后台屏幕播放尚未加载，请重载本地服务' }, 503);
        if (request.method === 'GET') return json(background.view());
        if (request.method === 'POST') return json(await background.command((await body(request)).action));
      }
      if (name === 'screen-control') {
        if (!display) return json({ error: '设备画面推送尚未加载' }, 503);
        if (request.method === 'GET') return json(await display.info());
        if (request.method === 'POST') {
          const input = await body(request);
          if (input.action === 'start') return json(await display.start(input.clientId, input.config));
          if (input.action === 'stop') return json(await display.stop(input.clientId, input.streamId));
          throw new Error('设备画面控制操作无效');
        }
      }
      if (name === 'screen-frame' && request.method === 'POST') {
        if (!display) return json({ error: '设备画面推送尚未加载' }, 503);
        if (request.headers.get('Content-Type') !== 'application/octet-stream') throw new Error('设备画面须为二进制 RGB565');
        const chunks = []; let size = 0;
        for await (const chunk of request.body || []) {
          size += chunk.byteLength;
          if (size > MAX_FRAME_BYTES) return json({ error: '设备画面超过最大尺寸' }, 413);
          chunks.push(Buffer.from(chunk));
        }
        const rawSequence = request.headers.get('X-Lease-Sequence') || '';
        if (!/^[0-9]{1,10}$/.test(rawSequence)) throw new Error('设备画面序号无效');
        return json(await display.frame(request.headers.get('X-Lease-Client-Id'), request.headers.get('X-Lease-Stream-Id'), Number(rawSequence), Buffer.concat(chunks)), 202);
      }
      if (['media', 'media-file', 'media-import'].includes(name)) {
        if (!media) return json({ error: '素材库尚未加载' }, 503);
        await media.ready;
        if (name === 'media' && request.method === 'GET') return json(media.view());
        if (name === 'media-file' && request.method === 'GET') return await media.response(id(url.searchParams.get('id')), request.headers.get('Range'));
        if (name === 'media-import' && request.method === 'POST') {
          const parts = []; let size = 0;
          for await (const chunk of request.body || []) {
            size += chunk.byteLength;
            if (size > MAX_MEDIA_BYTES) return json({ error: '素材单个文件不能超过 32MiB' }, 413);
            parts.push(Buffer.from(chunk));
          }
          return json(await media.import(decodeURIComponent(request.headers.get('X-Lease-Filename') || ''), Buffer.concat(parts)), 201);
        }
        if (name === 'media' && request.method === 'POST') {
          const input = await body(request);
          if (input.action === 'scan') return json(await media.change(() => media.scan()));
          if (input.action === 'remove') return json(await media.remove(input.id));
          return json(await media.update(input));
        }
      }
      if (name === 'config' && request.method === 'GET') return json({ ...store.public(), preview });
      if (name === 'config' && request.method === 'POST') {
        const previous = store.get();
        const result = store.save(await body(request));
        if (JSON.stringify(previous.device) !== JSON.stringify(store.get().device)) { await background?.stop(); await display?.dispose(); }
        if (previous.mode !== result.mode || previous.outputTarget !== result.outputTarget || JSON.stringify(previous.completion) !== JSON.stringify(result.completion) || JSON.stringify(previous.device) !== JSON.stringify(store.get().device) || previous.activeProvider !== result.activeProvider || JSON.stringify(previous.providers) !== JSON.stringify(store.get().providers)) tasks.cancelAutomatic();
        return json({ ...result, preview });
      }
      if (name === 'events' && request.method === 'GET') {
        const sid = id(url.searchParams.get('sessionId'));
        const after = url.searchParams.get('after');
        const cursor = after === null ? replies.cursor : Number(after);
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('事件游标无效');
        const mode = store.get().mode;
        return json({ ...replies.since(sid, cursor), mode, completion: store.get().completion });
      }
      if (name === 'lease' && request.method === 'POST') {
        const input = await body(request);
        return json({ granted: tasks.lease(id(input.sessionId), id(input.clientId), input.release === true) });
      }
      if (name === 'synthesize' && request.method === 'POST') {
        const input = await body(request);
        const clientId = id(input.clientId);
        let text, autoKey, sessionId;
        const chime = input.chime === true;
        if (input.messageId) {
          sessionId = id(input.sessionId);
          const messageId = id(input.messageId);
          text = readMessage(await getSession(sessionId), messageId);
          if (input.automatic === true) {
            // 先完成提示，再正文；已实时领取的同窗口队列允许等待前面的提示/朗读。
            if (!replies.events.some(e => e.sessionId === sessionId && e.messageId === messageId && Date.now() - e.at < 15 * 60000)) throw new Error('该消息不在自动播放窗口内');
            autoKey = chime ? `chime:${sessionId}:${messageId}` : `${sessionId}:${messageId}:${createHash('sha256').update(text).digest('hex')}:${store.get().outputTarget || 'browser'}`;
          }
        } else {
          if (input.automatic) throw new Error('自动朗读必须指定消息');
          if (!chime && (typeof input.text !== 'string' || input.text.length > 2000)) throw new Error('试听文本须在 2000 字内');
          text = input.text;
        }
        if (chime) await sounds?.ready;
        return json(tasks.start({ text, clientId, autoKey, sessionId, generation: input.generation, chime, clipId: input.automatic ? undefined : input.clipId }), 202);
      }
      if (name === 'task' && request.method === 'GET') return json(tasks.view(tasks.get(id(url.searchParams.get('id')), id(url.searchParams.get('clientId')))));
      if (name === 'audio' && request.method === 'GET') {
        const job = tasks.get(id(url.searchParams.get('id')), id(url.searchParams.get('clientId')));
        const index = Number(url.searchParams.get('segment'));
        if (!['ready', 'completed'].includes(job.state) || !Number.isInteger(index) || index < 0 || !job.segments[index]) throw new Error('音频尚未准备好或已过期');
        const segment = job.segments[index];
        if (segment.format === 'pcm_s16le' && segment.channels === 1 && segment.sampleRate === 24000) return new Response(wavFromPcm(segment.bytes), { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
        return new Response(segment.bytes, { headers: { 'Content-Type': segment.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
      }
      if (name === 'cancel' && request.method === 'POST') {
        const input = await body(request);
        tasks.cancel(id(input.clientId), input.id ? id(input.id) : undefined, input.generation);
        return json({ ok: true });
      }
      if (name === 'device-debug' && request.method === 'POST') {
        const input = await body(request);
        return json(await debugDevice(store.get().device, input.action, input.value, deviceFetch));
      }
      return json({ error: '接口不存在' }, 404);
    } catch (error) {
      return json({ error: /^(素材|请|配置|朗读|Provider|鉴权|语速|设备|请求|主会话|找不到|没有|本次|语音|音频|提供商|TTS|火山|MiniMax|Speech|当前|该消息|自动|试听|接口)/.test(error.message) ? error.message : '操作失败，请检查输入或服务状态' }, 400);
    }
  };
}
