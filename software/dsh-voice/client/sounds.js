import { api } from './player.js';
import { normalizeAudio, importSound, downloadWav } from './audio-tools.js';

export class SoundPanel {
  constructor(player, notice, changed) { this.player = player; this.notice = notice; this.changed = changed; this.busy = false; }
  async load(config) {
    this.items = (await api('sounds')).items;
    const selected = new Set(config.completion?.clipIds || []);
    document.getElementById('completion-sound').value = config.completion?.sound || 'ding';
    this.render(selected);
  }
  selected() { return [...document.querySelectorAll('#sound-list input:checked')].map(x => x.value); }
  render(selected = new Set(this.selected())) {
    const list = document.getElementById('sound-list'); list.replaceChildren();
    document.getElementById('sound-count').textContent = `${this.items.length} 段本地语音 · 勾选后保存提示设置`; 
    for (const item of this.items) {
      const row = document.createElement('div'); row.className = 'media-row';
      const label = document.createElement('label'); label.className = 'sound-choice';
      const check = document.createElement('input'); check.type = 'checkbox'; check.value = item.id; check.checked = selected.has(item.id); check.setAttribute('aria-label', `选用 ${item.name}`);
      check.addEventListener('change', this.changed);
      const title = document.createElement('span'); title.textContent = `${item.name} · ${item.seconds.toFixed(2)} 秒`;
      label.append(check, title); row.append(label);
      const actions = document.createElement('div'); actions.className = 'row-actions';
      const button = (text, action) => { const el = document.createElement('button'); el.type = 'button'; el.textContent = text; el.setAttribute('aria-label', `${text} ${item.name}`); el.addEventListener('click', action); return el; };
      actions.append(button('试听', () => this.player.enqueue({ chime: true, clipId: item.id })), button('下载', () => void this.perform(async () => {
        const response = await fetch(`/api/lease-voice/sound-file?id=${item.id}`, { credentials: 'same-origin' });
        if (!response.ok) throw new Error('音频素材读取失败'); downloadWav(await response.blob(), item.name);
      })), button('删除', () => {
        if (confirm(`删除本地提示音“${item.name}”？原始素材文件不会删除。`)) void this.perform(async () => {
          const selection = new Set(this.selected()); this.items = (await api('sounds', { action: 'remove', id: item.id })).items;
          this.render(selection); this.changed(); this.notice('本地提示音已删除，请保存更新后的选择。');
        });
      }));
      row.append(actions); list.append(row);
    }
    if (!this.items.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = '还没有语音素材。导入 MP3/WAV，或把合成结果保存到素材库。'; list.append(p); }
  }
  async perform(fn) {
    if (this.busy) return; this.busy = true;
    try { await fn(); } catch (e) { this.notice(e.message || '音频操作失败', true); }
    finally { this.busy = false; }
  }
  bind() {
    document.getElementById('sound-upload').addEventListener('change', e => {
      const files = [...e.target.files];
      void this.perform(async () => {
        const selected = new Set(this.selected()); let imported = 0; const errors = [];
        for (const file of files) {
          try {
            if (!/\.(mp3|wav)$/i.test(file.name) || file.size > 12 * 1024 * 1024) throw new Error('请使用12MiB以内的MP3/WAV');
            this.notice(`正在转换 ${file.name}…`);
            const result = await importSound(file.name, await normalizeAudio([file]));
            this.items = result.items; selected.add(result.item.id); imported++;
          } catch (error) { errors.push(`${file.name}：${error.message}`); }
        }
        e.target.value = ''; this.render(selected); this.changed();
        this.notice(`已导入 ${imported} 段提示音。${errors.join('；')}`, errors.length > 0);
      });
    });
  }
}
