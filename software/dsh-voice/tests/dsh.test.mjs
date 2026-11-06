import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../host/index.js';
import { ReplyTracker, readMessage } from '../core/replies.js';

const dsh = process.env.DSH_ROOT || 'D:/LEASE AI Software/Deepseek Harness';
const manifest = join(dsh, 'node_modules/@deepseek-ai/dsh/package.json');
test('真实 DSH Session/Connection：插件注册、owner 鉴权、输出读取和释放，不改请求链', { skip: !existsSync(manifest) }, async () => {
  const require = createRequire(manifest);
  const load = name => import(pathToFileURL(require.resolve(name)));
  const { Context } = await load('@deepseek-ai/cordis');
  const { HostConnectionService } = await load('@deepseek-ai/dsh-client-connection');
  const { Session } = await load('@deepseek-ai/dsh-session');
  const { createAssistantMessage, createUserMessage } = await load('@deepseek-ai/dsh-llm');
  const ctx = new Context();
  const connection = new HostConnectionService(ctx, [], { isAuthenticated: () => false, authenticateApi: () => undefined });
  const snapshots = new Map();
  ctx.sessionQuery = { readSession: async id => snapshots.get(id) };
  const beforeEnv = process.env.LEASE_VOICE_DATA_DIR;
  process.env.LEASE_VOICE_DATA_DIR = mkdtempSync(join(tmpdir(), 'lease-voice-dsh-'));
  try {
    apply(ctx);
    const fetcher = connection.createSharedFetchHandler('/api');
    const request = (name, body, peer = connection.browserPeer) => fetcher.fetch(new Request(`http://localhost/api/lease-voice/${name}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), peer);
    assert.equal(connection.requestRejection({ headers: { host: 'localhost' } }), 401);
    assert.equal((await request('config', undefined, { principal: { kind: 'guest' } })).status, 403);
    assert.equal((await request('config')).status, 200);
    assert.equal((await request('ui')).status, 200);
    assert.equal((await request('extensions')).status, 200);
    assert.equal((await request('screen')).status, 200);
    assert.equal((await request('media', undefined, { principal: { kind: 'guest' } })).status, 403);
    assert.equal((await request('media-import', { ignored: true }, { principal: { kind: 'guest' } })).status, 403);
    const mediaResult = await request('media');
    assert.equal(mediaResult.status, 200);
    assert.equal((await mediaResult.json()).output.requiresFirmware, 'M3');
    assert.equal((await request('screen-frame', { ignored: true }, { principal: { kind: 'guest' } })).status, 403);
    assert.equal((await request('sounds', undefined, { principal: { kind: 'guest' } })).status, 403);
    assert.equal((await request('sound-import', { ignored: true }, { principal: { kind: 'guest' } })).status, 403);
    assert.equal((await request('screen-playback', { action: 'start' }, { principal: { kind: 'guest' } })).status, 403);
    assert.equal(connection.requestRejection({ headers: { host: 'evil.example' } }), 403);

    const session = Session.create('voice-isolated');
    const events = [];
    const append = (type, data, surface = false) => {
      const event = session.append(type, data, ...(surface ? [{ surfaceOp: 'append' }] : []));
      const original = JSON.stringify(event);
      events.push(event);
      ctx.emit('session/event', session, event);
      assert.equal(JSON.stringify(event), original);
      return event;
    };
    append('turn/start', { turn: 1 });
    append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] }), true);
    const message = createAssistantMessage({ provider: 'mock', model: 'mock', content: [{ type: 'reasoning', text: '内部思考' }, { type: 'text', text: '**最终正文**' }] });
    append('assistant/message', { turn: 1, step: 1, message, stream: [] }, true);
    append('turn/end', { turn: 1, reason: { kind: 'completed' } });
    snapshots.set(session.id, { session: session.header, events });
    const notifications = await (await request(`events?sessionId=${session.id}&after=0`)).json();
    assert.equal(notifications.events.length, 1);
    assert.equal(notifications.events[0].messageId, message.id);
    const synthesized = await (await request('synthesize', { sessionId: session.id, messageId: message.id, clientId: 'native-client' })).json();
    assert.ok(synthesized.id);
    let status;
    for (let n = 0; n < 20; n++) {
      status = await (await request(`task?id=${synthesized.id}&clientId=native-client`)).json();
      if (status.state === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(status.state, 'failed');
    assert.match(status.error, /API Key/); // 空白配置在本地失败，不访问在线模型。
  } finally {
    await ctx.fiber.dispose();
    if (beforeEnv === undefined) delete process.env.LEASE_VOICE_DATA_DIR; else process.env.LEASE_VOICE_DATA_DIR = beforeEnv;
  }
  const removed = await connection.createSharedFetchHandler('/api').fetch(new Request('http://localhost/api/lease-voice/config'), connection.browserPeer);
  assert.equal(removed.status, 404);
});

const wrxModule = process.env.WRX_HOOK || 'D:/LEASE AI Project/LEASE-WRX/app/integrations/dsh/request-hook.js';
test('本机请求边界隔离对照：WRX 编排关闭/开启时 VOICE 不改变请求且只选最终输出', { skip: !existsSync(manifest) || !existsSync(wrxModule) }, async () => {
  const require = createRequire(manifest);
  const load = name => import(pathToFileURL(require.resolve(name)));
  const { Session } = await load('@deepseek-ai/dsh-session');
  const { createUserMessage, createAssistantMessage } = await load('@deepseek-ai/dsh-llm');
  const { Context } = await load('@deepseek-ai/cordis');
  const { HostConnectionService } = await load('@deepseek-ai/dsh-client-connection');
  const { registerRequestHook } = await import(pathToFileURL(wrxModule));
  const installed = require.resolve('@deepseek-ai/dsh-agent-loop');
  const original = readFileSync(installed, 'utf8');
  const dependencies = createRequire(installed);
  const isolated = original.replace(/from "([^".][^"]*)"/g, (match, name) => name.startsWith('node:') ? match : `from ${JSON.stringify(pathToFileURL(dependencies.resolve(name)).href)}`);
  const directory = mkdtempSync(join(tmpdir(), 'lease-voice-wrx-'));
  const copy = join(directory, 'agent.mjs');
  writeFileSync(copy, `${isolated}\nexport { ReactLoopAgent };\n`);
  try {
    const { ReactLoopAgent } = await import(pathToFileURL(copy));
    for (const enabled of [false, true]) {
      const session = Session.create(`voice-wrx-${enabled}`);
      const input = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '测试输入' }] });
      session.append('user/message', input, { surfaceOp: 'append' });
      const loop = Object.create(ReactLoopAgent.prototype);
      Object.assign(loop, { session, frozenMessages: new WeakSet(), leaseWrxAssembly: { sections: [], contexts: [] } });
      const state = { active_preset_id: 'test', presets: [{ id: 'test', name: 'test', prompts: [{ identifier: 'fixed', role: 'system', content: 'WRX 预设哨兵' }, { identifier: 'current', role: 'user', source: 'current_user' }], prompt_order: [{ identifier: 'fixed' }, { identifier: 'current' }] }] };
      const hook = registerRequestHook({ loadState: () => state, loadConfig: () => ({ prompting: { enabled, timestamps: { enabled: false } } }) });
      try {
        const signal = new AbortController().signal;
        const config = { provider: 'offline', model: 'test' };
        const before = loop.buildRequest(config, undefined, [], { turn: 1, step: 1 }, true, signal);
        const ctx = new Context();
        const connection = new HostConnectionService(ctx, [], { isAuthenticated: () => false, authenticateApi: () => undefined });
        ctx.sessionQuery = { readSession: async () => ({ session: session.header, events: [] }) };
        const beforeEnv = process.env.LEASE_VOICE_DATA_DIR;
        process.env.LEASE_VOICE_DATA_DIR = mkdtempSync(join(tmpdir(), 'lease-voice-wrx-config-'));
        try {
        apply(ctx);
        const tracker = new ReplyTracker();
        const after = loop.buildRequest(config, undefined, [], { turn: 1, step: 1 }, true, signal);
        assert.deepEqual(after.messages, before.messages);
        assert.equal(hook.status().hookObserved, true);
        assert.equal(after.messages.some(m => m.content.some(b => b.text === 'WRX 预设哨兵')), enabled);
        const final = createAssistantMessage({ provider: 'offline', model: 'test', content: [{ type: 'reasoning', text: '不朗读思考' }, { type: 'text', text: '唯一最终正文' }] });
        tracker.consume(session, { type: 'turn/start', data: { turn: 1 } });
        tracker.consume(session, { type: 'user/message', data: input });
        ctx.emit('session/event', session, { type: 'turn/start', data: { turn: 1 } });
        ctx.emit('session/event', session, { type: 'user/message', data: input });
        const event = session.append('assistant/message', { turn: 1, step: 1, message: final, stream: [] }, { surfaceOp: 'append' });
        tracker.consume(session, event);
        ctx.emit('session/event', session, event);
        tracker.consume(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
        ctx.emit('session/event', session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
        const response = await connection.createSharedFetchHandler('/api').fetch(new Request(`http://localhost/api/lease-voice/events?sessionId=${session.id}&after=0`), connection.browserPeer);
        assert.equal((await response.json()).events[0].messageId, final.id);
        assert.equal(tracker.since(session.id, 0).events[0].messageId, final.id);
        assert.equal(readMessage({ session: session.header, events: [event] }, final.id), '唯一最终正文');
        } finally {
          await ctx.fiber.dispose();
          if (beforeEnv === undefined) delete process.env.LEASE_VOICE_DATA_DIR; else process.env.LEASE_VOICE_DATA_DIR = beforeEnv;
        }
      } finally { hook.dispose(); }
    }
    assert.equal(readFileSync(installed, 'utf8'), original);
  } finally { unlinkSync(copy); rmdirSync(directory); }
});
