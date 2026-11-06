import { speechText } from './text.js';

// 只消费实时会话事件；不注册请求编排钩子、不依赖 WRX。
export class ReplyTracker {
  turns = new Map();
  events = [];
  cursor = 0;
  consume(session, event) {
    if (!session?.id || session.header?.parentSession) return;
    const data = event.data || {};
    const key = `${session.id}:${data.turn}`;
    if (event.type === 'turn/start') {
      this.turns.set(key, { human: false, message: null });
      while (this.turns.size > 256) this.turns.delete(this.turns.keys().next().value);
    }
    // user/message 的 turn 不一定在 data 上，以当前会话的活动 turn 为准。
    if (event.type === 'user/message') {
      const source = data.source?.kind;
      if (source === 'user-rpc' || source === 'user') {
        for (const [id, turn] of this.turns) if (id.startsWith(`${session.id}:`)) turn.human = true;
      }
    }
    const state = this.turns.get(key);
    if (!state) return;
    if (event.type === 'assistant/message') state.message = data.interrupted ? null : data.message;
    if (event.type !== 'turn/end') return;
    this.turns.delete(key);
    const message = state.message;
    if (data.reason?.kind !== 'completed' || !state.human || !message?.id || message.content?.some(b => /tool[_-]?(call|use)/.test(b.type))) return;
    if (!speechText(message.content)) return;
    if (this.events.some(item => item.sessionId === session.id && item.messageId === message.id)) return;
    this.events.push({ cursor: ++this.cursor, sessionId: session.id, messageId: message.id, at: Date.now() });
    if (this.events.length > 128) this.events.shift();
  }
  since(sessionId, cursor) { return { cursor: this.cursor, events: this.events.filter(e => e.sessionId === sessionId && e.cursor > cursor && Date.now() - e.at < 30000) }; }
}

export function readMessage(snapshot, messageId) {
  if (!snapshot || snapshot.session?.parentSession) throw new Error('主会话尚未载入或不可用');
  const event = snapshot.events.findLast(e => e.type === 'assistant/message' && e.data?.message?.id === messageId);
  if (!event || event.data.interrupted) throw new Error('找不到可朗读的完整助手消息');
  return speechText(event.data.message.content);
}
