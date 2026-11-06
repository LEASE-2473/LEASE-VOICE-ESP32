import { mkdir, readFile, writeFile, rename, readdir, realpath, stat, unlink, open } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, extname, basename, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { displayConfig } from '../extensions/display.js';

export const MAX_MEDIA_BYTES = 32 * 1024 * 1024;
const MAX_LIBRARY_BYTES = 256 * 1024 * 1024;
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.webm': 'video/webm', '.mp4': 'video/mp4' };
const defaults = () => ({ version: 1, roots: { pet: '', meme: '' }, imported: [], playlist: [], display: displayConfig().config, playback: { order: 'sequential', seconds: 5, fit: 'contain', zoom: 1, background: '#10151d', width: 128, height: 160 } });
const inside = (root, path) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel); };
const error = message => new Error(`素材${message}`);
function signature(bytes, extension) {
  if (['.jpg', '.jpeg'].includes(extension)) return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (extension === '.png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === '.gif') return /^GIF8[79]a/.test(bytes.toString('ascii', 0, 6));
  if (extension === '.webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (extension === '.webm') return bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
  if (extension === '.mp4') return bytes.toString('ascii', 4, 8) === 'ftyp';
  return false;
}

export class MediaLibrary {
  entries = new Map();
  state = defaults();
  warnings = [];
  mutation = Promise.resolve();
  constructor(directory, { home = process.env.DSH_HOME || process.cwd() } = {}) {
    this.directory = directory;
    this.home = home;
    this.file = join(directory, 'screen.json');
    this.ready = this.load();
  }
  async load() {
    let text;
    try { text = await readFile(this.file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (text) {
      const disk = JSON.parse(text);
      if (disk.version !== 1 || !Array.isArray(disk.imported) || !Array.isArray(disk.playlist)) throw error('库版本或格式无效');
      this.state = { ...defaults(), ...disk, roots: { ...defaults().roots, ...disk.roots }, playback: { ...defaults().playback, ...disk.playback } };
    }
    await this.scan();
  }
  async discover() {
    const roots = { pet: [], meme: [join(this.home, 'meme-packs')] };
    const resolvers = [createRequire(import.meta.url), createRequire(join(resolve(this.home), 'package.json')), createRequire(join(resolve(this.home), 'profiles/web/package.json'))];
    for (const require of resolvers) {
      for (const [kind, names, suffix] of [['pet', ['dsh-pet', '@linxin666/dsh-pet'], 'assets/webm'], ['meme', ['dsh-meme'], 'memes']]) {
        for (const name of names) {
          try { roots[kind].push(join(dirname(require.resolve(`${name}/package.json`)), suffix)); } catch { /* 可选插件未安装 */ }
        }
      }
    }
    return roots;
  }
  async scan() {
    const entries = new Map(), warnings = [], roots = await this.discover();
    const add = async (root, file, source, name) => {
      try {
        const path = await realpath(file);
        if (!inside(root, path)) return;
        const info = await stat(path), extension = extname(path).toLowerCase();
        if (!info.isFile() || info.size > MAX_MEDIA_BYTES || !TYPES[extension]) return;
        const handle = await open(path, 'r');
        let head;
        try { head = Buffer.alloc(16); await handle.read(head, 0, 16, 0); } finally { await handle.close(); }
        if (!signature(head, extension)) return;
        const id = createHash('sha256').update(`${source}:${path}`).digest('hex').slice(0, 32);
        entries.set(id, { id, name: name || basename(path), source, kind: TYPES[extension].startsWith('video') ? 'video' : 'image', mime: TYPES[extension], bytes: info.size, path, root });
      } catch { /* 单个缺失、不可读或被删除的素材不阻断整个素材库 */ }
    };
    for (const source of ['pet', 'meme']) {
      const candidates = this.state.roots[source] ? [this.state.roots[source]] : roots[source];
      const visited = new Set();
      let count = 0, limited = false;
      const walk = async (directory, root, depth) => {
        if (depth > 5 || limited) return;
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (++count > 5000 || entries.size >= 2000) { limited = true; break; }
          if (entry.isSymbolicLink()) continue;
          const path = join(directory, entry.name);
          if (entry.isDirectory()) await walk(path, root, depth + 1);
          else if (TYPES[extname(entry.name).toLowerCase()]) await add(root, path, source);
        }
      };
      for (const candidate of candidates) {
        try {
          const root = await realpath(candidate);
          if (visited.has(root)) continue;
          visited.add(root);
          await walk(root, root, 0);
        } catch { if (this.state.roots[source]) warnings.push(`${source === 'pet' ? '桌宠' : '表情包'}目录无法读取，请检查路径。`); }
      }
      if (limited) warnings.push(`${source === 'pet' ? '桌宠' : '表情包'}扫描达到数量上限，请选择更小的素材目录。`);
    }
    await mkdir(join(this.directory, 'media'), { recursive: true });
    const root = await realpath(join(this.directory, 'media'));
    for (const item of this.state.imported) {
      if (/^[a-f0-9-]+\.(png|jpe?g|gif|webp|webm|mp4)$/.test(item.file || '')) await add(root, join(root, item.file), 'local', item.name);
    }
    this.entries = entries; this.warnings = warnings;
    return this.view();
  }
  view() {
    return { version: 1, roots: this.state.roots, playback: this.state.playback, playlist: this.state.playlist, display: this.state.display,
      items: [...this.entries.values()].map(({ path, root, ...item }) => item), warnings: this.warnings,
      output: { target: 'preview', backgroundSupported: true, deviceSupported: true, requiresFirmware: 'M3' }, limits: { fileBytes: MAX_MEDIA_BYTES, libraryBytes: MAX_LIBRARY_BYTES } };
  }
  async persist(next) {
    await mkdir(this.directory, { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, this.file);
    this.state = next;
  }
  async change(fn) {
    const pending = this.mutation.then(async () => { await this.ready; return fn(); });
    this.mutation = pending.catch(() => {});
    return pending;
  }
  async update(input) {
    return this.change(async () => {
      const next = structuredClone(this.state);
      if (input.display !== undefined) next.display = displayConfig(input.display).config;
      if (input.roots !== undefined) {
        for (const key of ['pet', 'meme']) if (input.roots[key] !== undefined) {
          const value = input.roots[key];
          if (typeof value !== 'string' || value.length > 2048 || /[\0\r\n]/.test(value) || (value.trim() && !isAbsolute(value.trim()))) throw error('目录须为电脑上的绝对路径，留空自动发现');
          next.roots[key] = value.trim();
        }
      }
      if (input.playlist !== undefined) {
        if (!Array.isArray(input.playlist) || input.playlist.length > 300 || input.playlist.some(id => !this.entries.has(id))) throw error('播放列表包含失效项目，请刷新后重试');
        next.playlist = [...new Set(input.playlist)];
      }
      if (input.playback !== undefined) {
        const p = { ...next.playback, ...input.playback };
        if (!['sequential', 'random'].includes(p.order) || !['contain', 'cover'].includes(p.fit) || !/^#[0-9a-f]{6}$/i.test(p.background) || !Number.isFinite(p.seconds) || p.seconds < 1 || p.seconds > 120 || ![[128, 160], [160, 128], [240, 240], [240, 320], [320, 240]].some(([w, h]) => p.width === w && p.height === h)) throw error('播放设置无效');
        if (!Number.isFinite(p.zoom) || p.zoom < 0.5 || p.zoom > 3) throw error('缩放须在 0.5 至 3 倍之间');
        next.playback = { order: p.order, seconds: p.seconds, fit: p.fit, zoom: p.zoom, background: p.background, width: p.width, height: p.height };
      }
      await this.persist(next);
      if (input.roots !== undefined) await this.scan();
      return this.view();
    });
  }
  async import(name, bytes) {
    return this.change(async () => {
      if (typeof name !== 'string' || !name.trim() || name.length > 200 || /[\0\r\n/\\]/.test(name)) throw error('文件名无效');
      const extension = extname(name).toLowerCase();
      if (!bytes.length || bytes.length > MAX_MEDIA_BYTES || !signature(bytes, extension)) throw error('格式不支持、文件内容不匹配或超过 32MiB');
      const local = [...this.entries.values()].filter(item => item.source === 'local');
      if (local.length >= 500 || local.reduce((sum, item) => sum + item.bytes, 0) + bytes.length > MAX_LIBRARY_BYTES) throw error('本地库已满（最多 500 个文件、256MiB）');
      const file = `${randomUUID()}${extension}`, path = join(this.directory, 'media', file);
      await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
      try { await this.persist({ ...this.state, imported: [...this.state.imported, { file, name }] }); }
      catch (e) { await unlink(path); throw e; }
      await this.scan();
      return this.view();
    });
  }
  async remove(id) {
    return this.change(async () => {
      const item = this.entries.get(id);
      if (!item || item.source !== 'local') throw error('只能删除本插件导入的本地文件，原插件素材只读');
      await this.persist({ ...this.state, imported: this.state.imported.filter(x => x.file !== basename(item.path)), playlist: this.state.playlist.filter(x => x !== id) });
      await unlink(item.path).catch(e => { if (e.code !== 'ENOENT') throw e; });
      await this.scan(); return this.view();
    });
  }
  async response(id, range) {
    await this.ready;
    const item = this.entries.get(id);
    if (!item) return new Response(null, { status: 404 });
    const path = await realpath(item.path).catch(() => '');
    if (!path || !inside(item.root, path)) return new Response(null, { status: 404 });
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_MEDIA_BYTES) throw error('文件已改变，请刷新素材库');
    const bytes = await readFile(path);
    if (bytes.length > MAX_MEDIA_BYTES || !signature(bytes, extname(path).toLowerCase())) throw error('文件已改变，请刷新素材库');
    const headers = { 'Content-Type': item.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
    if (!range) return new Response(bytes, { headers });
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = match?.[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match?.[2]));
    let end = match?.[1] ? (match[2] ? Number(match[2]) : bytes.length - 1) : bytes.length - 1;
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= bytes.length) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${bytes.length}` } });
    end = Math.min(end, bytes.length - 1);
    return new Response(bytes.subarray(start, end + 1), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } });
  }
}
