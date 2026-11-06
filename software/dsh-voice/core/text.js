export function speechText(content) {
  const text = typeof content === 'string' ? content : (content || [])
    .filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
  return text.replace(/```[\s\S]*?(?:```|$)/g, '').replace(/~~~[\s\S]*?(?:~~~|$)/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '').replace(/<[^>]*>/g, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+)/gm, '').replace(/[*_`~]/g, '')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function splitText(text, limit = 800) {
  const chars = Array.from(text);
  const parts = [];
  while (chars.length) {
    let end = Math.min(chars.length, limit);
    if (end < chars.length) {
      for (let n = end - 1; n > end / 2; n--) {
        if (/[。！？.!?\n；;]/u.test(chars[n])) { end = n + 1; break; }
      }
    }
    const part = chars.splice(0, end).join('').trim();
    if (part) parts.push(part);
  }
  return parts;
}
