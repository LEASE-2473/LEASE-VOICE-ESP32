(() => {
  // client/player.js
  var PREFIX = "/api/lease-voice";
  async function api(path, body, signal) {
    const response = await fetch(`${PREFIX}/${path}`, { credentials: "same-origin", signal, ...body === void 0 ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `\u8BF7\u6C42\u5931\u8D25 ${response.status}`);
    return result;
  }
  var VoicePlayer = class {
    // randomUUID 在 LAN 的普通 HTTP 页面上可能不可用；getRandomValues 仍可使用。
    clientId = globalThis.crypto?.randomUUID?.() || `browser-${Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(16).padStart(8, "0")).join("")}`;
    queue = [];
    current = null;
    audio = new Audio();
    status = "\u7B49\u5F85\u6717\u8BFB";
    listeners = /* @__PURE__ */ new Set();
    generation = 0;
    enabled = false;
    resume = null;
    constructor() {
      this.audio.preload = "auto";
    }
    subscribe(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }
    notify(status) {
      this.status = status;
      for (const fn of this.listeners) fn(status);
    }
    async enable() {
      if (this.resume) {
        try {
          await this.audio.play();
          this.resume?.();
          this.resume = null;
          this.enabled = true;
          this.notify("\u64AD\u653E\u4E2D");
        } catch {
          this.notify("\u8BF7\u518D\u6B21\u70B9\u51FB\u542F\u7528\u58F0\u97F3");
        }
        return;
      }
      const wave = new Uint8Array(46);
      const view = new DataView(wave.buffer);
      const write = (at, text) => [...text].forEach((c, n) => {
        wave[at + n] = c.charCodeAt(0);
      });
      write(0, "RIFF");
      view.setUint32(4, 38, true);
      write(8, "WAVEfmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 8e3, true);
      view.setUint32(28, 16e3, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      write(36, "data");
      view.setUint32(40, 2, true);
      const url = URL.createObjectURL(new Blob([wave], { type: "audio/wav" }));
      this.audio.src = url;
      try {
        await this.audio.play();
        this.enabled = true;
        this.notify("\u58F0\u97F3\u5DF2\u542F\u7528");
      } catch {
        this.notify("\u6D4F\u89C8\u5668\u6682\u672A\u5141\u8BB8\u64AD\u653E\uFF0C\u8BF7\u518D\u6B21\u70B9\u51FB");
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    enqueue(input) {
      if (this.queue.length >= 8) {
        this.notify("\u5F85\u64AD\u961F\u5217\u5DF2\u6EE1");
        return;
      }
      const beforeSpeech = input.chime && input.automatic ? this.queue.findIndex((item) => !item.chime) : -1;
      if (beforeSpeech >= 0) this.queue.splice(beforeSpeech, 0, input);
      else this.queue.push(input);
      if (!this.current) void this.pump();
    }
    async pump() {
      const input = this.queue.shift();
      if (!input) return;
      const generation = this.generation;
      const current = { input, controller: new AbortController(), id: null };
      this.current = current;
      try {
        this.notify(input.chime ? "\u51C6\u5907\u5B8C\u6210\u63D0\u793A\u2026" : "\u5408\u6210\u4E2D\u2026");
        const started = await api("synthesize", { ...input, clientId: this.clientId, generation }, current.controller.signal);
        if (started.duplicate) {
          this.notify("\u672C\u6761\u5DF2\u5728\u5176\u4ED6\u7A97\u53E3\u5904\u7406");
          return;
        }
        current.id = started.id;
        let task = started;
        while (!["ready", "completed", "failed", "canceled"].includes(task.state)) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          current.controller.signal.throwIfAborted();
          task = await api(`task?id=${started.id}&clientId=${this.clientId}`, void 0, current.controller.signal);
          this.notify(task.target === "esp32" && ["sending", "playing"].includes(task.state) ? `${task.state === "sending" ? "\u53D1\u9001\u5230\u8BBE\u5907" : "\u8BBE\u5907\u64AD\u653E\u4E2D"} ${task.completed + 1}/${task.total || 1}` : `\u5408\u6210\u4E2D ${task.completed}/${task.total || 1}`);
        }
        if (task.state === "failed") throw new Error(task.error);
        if (task.state === "canceled" || generation !== this.generation) return;
        if (!input.chime) this.lastTask = { id: task.id, target: task.target };
        if (task.target === "esp32") {
          this.notify("\u8BBE\u5907\u64AD\u653E\u5B8C\u6210");
          return;
        }
        for (const segment of task.segments) {
          current.controller.signal.throwIfAborted();
          const response = await fetch(`${PREFIX}/audio?id=${started.id}&clientId=${this.clientId}&segment=${segment}`, { signal: current.controller.signal });
          if (!response.ok) throw new Error("\u97F3\u9891\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210");
          const url = URL.createObjectURL(await response.blob());
          try {
            current.controller.signal.throwIfAborted();
            this.audio.src = url;
            await new Promise((resolve, reject) => {
              const cleanup = () => {
                this.audio.onended = null;
                this.audio.onerror = null;
                current.controller.signal.removeEventListener("abort", abort);
                this.resume = null;
              };
              const finish = () => {
                cleanup();
                resolve();
              };
              const abort = () => {
                cleanup();
                reject(new DOMException("\u505C\u6B62", "AbortError"));
              };
              this.audio.onended = finish;
              this.audio.onerror = () => {
                cleanup();
                reject(new Error("\u97F3\u9891\u65E0\u6CD5\u64AD\u653E\uFF0C\u8BF7\u68C0\u67E5\u63D0\u4F9B\u5546\u8FD4\u56DE\u683C\u5F0F"));
              };
              current.controller.signal.addEventListener("abort", abort, { once: true });
              this.audio.play().then(() => {
                this.enabled = true;
                this.notify("\u64AD\u653E\u4E2D");
              }).catch((error) => {
                if (error.name === "NotAllowedError") {
                  this.resume = () => this.notify("\u64AD\u653E\u4E2D");
                  this.notify("\u9700\u8981\u70B9\u51FB\u300C\u542F\u7528\u58F0\u97F3\u300D\u624D\u80FD\u64AD\u653E");
                } else {
                  cleanup();
                  reject(new Error("\u97F3\u9891\u65E0\u6CD5\u64AD\u653E\uFF0C\u8BF7\u68C0\u67E5\u683C\u5F0F"));
                }
              });
            });
          } finally {
            URL.revokeObjectURL(url);
          }
        }
        this.notify("\u64AD\u653E\u5B8C\u6210");
      } catch (error) {
        if (generation === this.generation && error.name !== "AbortError") this.notify(error.message || "\u6717\u8BFB\u5931\u8D25");
      } finally {
        if (this.current === current) {
          this.current = null;
          if (this.queue.length) void this.pump();
        }
      }
    }
    stop(automaticOnly = false) {
      const matches = (item) => !automaticOnly || item?.automatic && (automaticOnly === "speech" ? !item.chime : automaticOnly === "chime" ? item.chime : true);
      this.queue = this.queue.filter((item) => !matches(item));
      if (automaticOnly && !matches(this.current?.input)) return;
      this.generation++;
      this.current?.controller.abort();
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.resume = null;
      void api("cancel", { clientId: this.clientId, generation: this.generation }).catch(() => {
      });
      this.notify("\u5DF2\u505C\u6B62");
    }
    dispose() {
      this.stop();
      this.listeners.clear();
    }
  };

  // client/entry.js
  window.__ModuleLoader__.load({
    id: "dsh-lease-voice",
    factory: (require2) => {
      const React = require2("react");
      const h = React.createElement;
      let player;
      const ready = Promise.resolve().then(() => {
        player = new VoicePlayer();
        return { player, api };
      });
      function Settings({ extension = false }) {
        return h("iframe", { title: extension ? "\u8BED\u97F3\u6269\u5C55 \xB7 ESP32" : "\u8BED\u97F3\u8BBE\u7F6E", src: `/api/lease-voice/${extension ? "extensions" : "ui"}`, style: { width: "100%", height: "min(860px, 80vh)", minHeight: 580, border: 0, borderRadius: 12 }, allow: "autoplay" });
      }
      function Action({ messageId, sessionId }) {
        const [error, setError] = React.useState("");
        return h("button", { type: "button", title: error || "\u5C06\u672C\u6761\u56DE\u590D\u8F6C\u4E3A\u8BED\u97F3", "aria-label": "\u8F6C\u8BED\u97F3", onClick: () => {
          ready.then(({ player: player2 }) => {
            if (!sessionId) throw new Error("\u5F53\u524D\u5BBF\u4E3B\u672A\u63D0\u4F9B\u4F1A\u8BDD\u8EAB\u4EFD");
            player2.enqueue({ sessionId, messageId });
          }).catch((e) => setError(e.message));
        }, style: { border: 0, background: "transparent", color: "inherit", cursor: "pointer", padding: "4px 8px" } }, "\u266B \u8F6C\u8BED\u97F3");
      }
      function Controls({ sessionId }) {
        const [status, setStatus] = React.useState("\u7B49\u5F85\u6717\u8BFB");
        React.useEffect(() => {
          if (!sessionId) return;
          let disposed = false, cursor, mode, completionEnabled, unsubscribe;
          ready.then(({ player: player2, api: api2 }) => {
            if (disposed) return;
            unsubscribe = player2.subscribe(setStatus);
            setStatus(player2.status);
            const tick = async () => {
              if (disposed) return;
              try {
                const result = await api2(`events?sessionId=${encodeURIComponent(sessionId)}${cursor === void 0 ? "" : `&after=${cursor}`}`);
                if (disposed) return;
                const previous = mode;
                const previousCompletion = completionEnabled;
                mode = result.mode;
                completionEnabled = result.completion?.enabled === true;
                if (mode !== "auto") player2.stop("speech");
                if (previousCompletion && !completionEnabled) player2.stop("chime");
                if ((mode === "auto" || completionEnabled) && document.visibilityState === "visible") {
                  const lease = await api2("lease", { sessionId, clientId: player2.clientId });
                  if (!lease.granted) player2.stop(true);
                  if (!disposed && lease.granted && cursor !== void 0) {
                    for (const event of result.events) {
                      if (completionEnabled && previousCompletion) player2.enqueue({ sessionId, messageId: event.messageId, automatic: true, chime: true });
                      if (mode === "auto" && previous === "auto") player2.enqueue({ sessionId, messageId: event.messageId, automatic: true });
                    }
                  }
                } else if (previous === "auto" || previousCompletion) {
                  await api2("lease", { sessionId, clientId: player2.clientId, release: true });
                  player2.stop(true);
                }
                cursor = result.cursor;
              } catch (error) {
                if (!disposed) setStatus(`\u8BED\u97F3\uFF1A${error.message}`);
              } finally {
                if (!disposed) timer = setTimeout(tick, 1500);
              }
            };
            void tick();
          }).catch((e) => setStatus(e.message));
          let timer;
          const visibility = () => {
            if (document.visibilityState !== "visible") player?.stop(true);
          };
          document.addEventListener("visibilitychange", visibility);
          return () => {
            disposed = true;
            clearTimeout(timer);
            unsubscribe?.();
            document.removeEventListener("visibilitychange", visibility);
            ready.then(({ player: player2, api: api2 }) => {
              player2.stop();
              return api2("lease", { sessionId, clientId: player2.clientId, release: true });
            }).catch(() => {
            });
          };
        }, [sessionId]);
        return h(
          "span",
          { style: { display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12 } },
          h("button", { type: "button", onClick: () => ready.then(({ player: player2 }) => player2.enable()).catch((e) => setStatus(e.message)) }, "\u542F\u7528\u58F0\u97F3"),
          h("button", { type: "button", onClick: () => player?.stop() }, "\u505C\u6B62\u6717\u8BFB"),
          h("span", { role: "status", style: { maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: status }, status)
        );
      }
      return {
        inject: ["slots"],
        apply(ctx) {
          const slots = ctx.get("slots");
          const register = (name, id, label, component, order) => slots.inject(name, () => slots.register({ name, id, label, order }, component));
          register("settings.section", "lease-voice", "\u8BED\u97F3", () => h(Settings), 35);
          register("settings.section", "lease-voice-extensions", "\u8BED\u97F3\u6269\u5C55", () => h(Settings, { extension: true }), 36);
          register("conversation.chat.assistant-actions", "lease-voice-speak", "\u8F6C\u8BED\u97F3", (props) => h(Action, props), 60);
          register("conversation.session.header.utilities", "lease-voice-controls", "\u8BED\u97F3\u64AD\u653E", (props) => h(Controls, props), 60);
          ctx.effect(() => () => {
            ready.then(({ player: player2 }) => player2.dispose()).catch(() => {
            });
          }, "lease-voice:client-lifetime");
        }
      };
    }
  });
})();
