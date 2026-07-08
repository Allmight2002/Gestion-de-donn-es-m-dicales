export function parseScan(raw) {
  const text = String(raw ?? '').replaceAll('\0', '').trim();
  const found = text.match(/^stream:\s*(.+?)\s+FOUND$/i);
  if (found) return { status: 'infected', signature: found[1], raw: text };
  if (/^stream:\s*OK$/i.test(text)) return { status: 'clean', raw: text };
  return { status: 'error', raw: text };
}
