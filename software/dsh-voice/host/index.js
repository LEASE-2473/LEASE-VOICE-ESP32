import { fileURLToPath } from 'node:url';
import { createConfigStore } from './config.js';
import { createHandler, PREFIX, ROUTES } from './routes.js';
import { TaskService } from '../core/tasks.js';
import { ReplyTracker } from '../core/replies.js';
import { MediaLibrary } from '../core/media-library.js';
import { DisplayService } from '../extensions/display.js';
import { SoundLibrary } from '../core/sounds.js';
import { BackgroundScreen } from '../core/screen-background.js';

export const name = 'dsh-lease-voice';
export const inject = ['connection', 'sessionQuery'];

export function apply(ctx) {
  const directory = process.env.LEASE_VOICE_DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url));
  const store = createConfigStore(directory);
  const sounds = new SoundLibrary(directory);
  sounds.ready.catch(() => ctx.logger?.warn?.('VOICE：提示音素材库读取失败，请检查 sounds.json'));
  const tasks = new TaskService(store, undefined, { sounds });
  const replies = new ReplyTracker();
  const media = new MediaLibrary(directory);
  const display = new DisplayService(store);
  const background = new BackgroundScreen(media, display);
  media.ready.catch(() => ctx.logger?.warn?.('VOICE：素材库读取失败，请检查 screen.json'));
  const handler = createHandler({ store, tasks, replies, media, display, sounds, background, getSession: sessionId => ctx.sessionQuery.readSession(sessionId) });
  ctx.on('session/event', (session, event) => {
    try { replies.consume(session, event); } catch { ctx.logger?.warn?.('VOICE：忽略无法识别的会话输出事件'); }
  });
  for (const route of ROUTES) {
    ctx.effect(() => ctx.connection.fetch.register({ path: `${PREFIX}/${route}`, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: handler }), `lease-voice:${route}`);
  }
  ctx.effect(() => {
    const timer = setInterval(() => tasks.cleanup(), 60000);
    timer.unref?.();
    return () => { clearInterval(timer); tasks.dispose(); void background.dispose().finally(() => display.dispose()); };
  }, 'lease-voice:lifetime');
  ctx.logger?.info?.('LEASE VOICE：已注册语音设置、扩展页面与输出侧事件监听');
}
