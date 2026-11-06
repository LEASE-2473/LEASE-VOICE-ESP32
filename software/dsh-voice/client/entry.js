import { VoicePlayer, api } from './player.js';

window.__ModuleLoader__.load({
  id: 'dsh-lease-voice',
  factory: require => {
    const React = require('react');
    const h = React.createElement;
    let player;
    const ready = Promise.resolve().then(() => {
      player = new VoicePlayer();
      return { player, api };
    });

    function Settings({ extension = false }) {
      return h('iframe', { title: extension ? '语音扩展 · ESP32' : '语音设置', src: `/api/lease-voice/${extension ? 'extensions' : 'ui'}`, style: { width: '100%', height: 'min(860px, 80vh)', minHeight: 580, border: 0, borderRadius: 12 }, allow: 'autoplay' });
    }
    function Action({ messageId, sessionId }) {
      const [error, setError] = React.useState('');
      return h('button', { type: 'button', title: error || '将本条回复转为语音', 'aria-label': '转语音', onClick: () => {
        ready.then(({ player }) => {
          if (!sessionId) throw new Error('当前宿主未提供会话身份');
          player.enqueue({ sessionId, messageId });
        }).catch(e => setError(e.message));
      }, style: { border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: '4px 8px' } }, '♫ 转语音');
    }
    function Controls({ sessionId }) {
      const [status, setStatus] = React.useState('等待朗读');
      React.useEffect(() => {
        if (!sessionId) return;
        let disposed = false, cursor, mode, completionEnabled, unsubscribe;
        ready.then(({ player, api }) => {
          if (disposed) return;
          unsubscribe = player.subscribe(setStatus);
          setStatus(player.status);
          const tick = async () => {
            if (disposed) return;
            try {
              const result = await api(`events?sessionId=${encodeURIComponent(sessionId)}${cursor === undefined ? '' : `&after=${cursor}`}`);
              if (disposed) return;
              const previous = mode;
              const previousCompletion = completionEnabled;
              mode = result.mode;
              completionEnabled = result.completion?.enabled === true;
              if (mode !== 'auto') player.stop('speech');
              if (previousCompletion && !completionEnabled) player.stop('chime');
              // 后台标签页不领取播放资格；每次轮询都推进游标，避免回来补读。
              if ((mode === 'auto' || completionEnabled) && document.visibilityState === 'visible') {
                const lease = await api('lease', { sessionId, clientId: player.clientId });
                if (!lease.granted) player.stop(true);
                if (!disposed && lease.granted && cursor !== undefined) {
                  for (const event of result.events) {
                    if (completionEnabled && previousCompletion) player.enqueue({ sessionId, messageId: event.messageId, automatic: true, chime: true });
                    if (mode === 'auto' && previous === 'auto') player.enqueue({ sessionId, messageId: event.messageId, automatic: true });
                  }
                }
              } else if (previous === 'auto' || previousCompletion) {
                await api('lease', { sessionId, clientId: player.clientId, release: true });
                player.stop(true);
              }
              cursor = result.cursor;
            } catch (error) { if (!disposed) setStatus(`语音：${error.message}`); }
            finally { if (!disposed) timer = setTimeout(tick, 1500); }
          };
          void tick();
        }).catch(e => setStatus(e.message));
        let timer;
        const visibility = () => { if (document.visibilityState !== 'visible') player?.stop(true); };
        document.addEventListener('visibilitychange', visibility);
        return () => {
          disposed = true; clearTimeout(timer); unsubscribe?.();
          document.removeEventListener('visibilitychange', visibility);
          ready.then(({ player, api }) => { player.stop(); return api('lease', { sessionId, clientId: player.clientId, release: true }); }).catch(() => {});
        };
      }, [sessionId]);
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12 } },
        h('button', { type: 'button', onClick: () => ready.then(({ player }) => player.enable()).catch(e => setStatus(e.message)) }, '启用声音'),
        h('button', { type: 'button', onClick: () => player?.stop() }, '停止朗读'),
        h('span', { role: 'status', style: { maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: status }, status));
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.get('slots');
        const register = (name, id, label, component, order) => slots.inject(name, () => slots.register({ name, id, label, order }, component));
        register('settings.section', 'lease-voice', '语音', () => h(Settings), 35);
        register('settings.section', 'lease-voice-extensions', '语音扩展', () => h(Settings, { extension: true }), 36);
        register('conversation.chat.assistant-actions', 'lease-voice-speak', '转语音', props => h(Action, props), 60);
        register('conversation.session.header.utilities', 'lease-voice-controls', '语音播放', props => h(Controls, props), 60);
        ctx.effect(() => () => { ready.then(({ player }) => player.dispose()).catch(() => {}); }, 'lease-voice:client-lifetime');
      },
    };
  },
});
