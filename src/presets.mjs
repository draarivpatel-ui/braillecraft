// presets.mjs: built-in community signage templates and the URL-hash
// shareable state codec (no dependencies, browser and Node safe).

export const PRESETS = [
  {
    id: 'library-quiet',
    title: 'Library Quiet Zone',
    text: 'QUIET ZONE',
    grade: 2,
    caption: 'Quiet Zone',
    note: 'School library collaborative sign; ADA raised characters plus Grade 2 Braille.'
  },
  {
    id: 'lab-eyewash',
    title: 'Science Lab Eyewash',
    text: 'EYEWASH STATION',
    grade: 2,
    caption: 'Eyewash',
    note: 'Safety signage; ADA 703.3 calls for contracted Grade 2 Braille.'
  },
  {
    id: 'restroom',
    title: 'Accessible Restroom',
    text: 'RESTROOM',
    grade: 2,
    caption: 'Restroom',
    note: 'Single-word ADA room sign with mounting-hole drill callouts.'
  },
  {
    id: 'stem-club',
    title: 'STEM Club Room 204',
    text: 'STEM CLUB ROOM 204',
    grade: 2,
    caption: 'STEM Club Room 204',
    note: 'Classroom identification; numbers switch to numeric mode.'
  },
  {
    id: 'exit-stairwell',
    title: 'Emergency Exit Stairwell',
    text: 'EXIT STAIRWELL B',
    grade: 2,
    caption: 'Exit Stairwell B',
    note: 'Egress signage; ADA 703.3 calls for contracted Grade 2 Braille.'
  }
];

export function presetById(id) {
  return PRESETS.find(p => p.id === id) || null;
}

// ---------------------------------------------------------------------------
// URL hash state:  #v=1&tab=studio&g=2&max=32&t=<base64url>
// Malformed or partial hashes decode to a clean default instead of throwing.
// ---------------------------------------------------------------------------

const HASH_VERSION = 1;
// Share links are input as much as output. Cap each decoded field at the same
// size the UI can legitimately produce so a hostile hash cannot make bootstrap
// lay out or parse an unbounded plaque or kit.
export const MAX_SHARE_TEXT_LENGTH = 240;
export const MAX_SHARE_TEXT_PARAM_LENGTH = 1024;
export const MAX_SHARE_KIT_BYTES = 6144;
export const MAX_SHARE_KIT_PARAM_LENGTH = 8192;

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(b64) {
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeHash(state) {
  const p = new URLSearchParams();
  p.set('v', String(HASH_VERSION));
  if (state.tab) p.set('tab', state.tab);
  if (state.grade === 1 || state.grade === 2) p.set('g', String(state.grade));
  if (Number.isInteger(state.maxCols)) p.set('max', String(state.maxCols));
  if (state.preset) p.set('p', String(state.preset));
  if (state.lesson) p.set('l', String(state.lesson));
  if (state.muted) p.set('m', '1');
  if (state.theme) p.set('th', state.theme === 'dark' ? 'd' : 'l');
  if (typeof state.text === 'string') p.set('t', b64urlEncode(state.text));
  if (state.kit && typeof state.kit === 'object') p.set('k', b64urlEncode(JSON.stringify(state.kit)));
  return '#' + p.toString();
}

export function decodeHash(hash) {
  const out = {};
  try {
    const h = String(hash || '').replace(/^#/, '');
    if (!h) return out;
    const p = new URLSearchParams(h);
    if (p.has('tab')) {
      const t = p.get('tab');
      if (['studio', 'kit', 'trainer', 'tests'].includes(t)) out.tab = t;
    }
    if (p.has('g')) {
      const g = Number(p.get('g'));
      if (g === 1 || g === 2) out.grade = g;
    }
    if (p.has('max')) {
      const m = Number(p.get('max'));
      if (Number.isInteger(m) && m >= 4 && m <= 40) out.maxCols = m;
    }
    if (p.has('p') && presetById(p.get('p'))) out.preset = p.get('p');
    if (p.has('l') && /^[a-z-]{1,24}$/.test(p.get('l'))) out.lesson = p.get('l');
    if (p.get('m') === '1') out.muted = true;
    if (p.has('th')) {
      const th = p.get('th');
      if (th === 'd' || th === 'l') out.theme = th === 'd' ? 'dark' : 'light';
    }
    if (p.has('t')) {
      const encoded = p.get('t');
      if (encoded.length <= MAX_SHARE_TEXT_PARAM_LENGTH) {
        const text = b64urlDecode(encoded);
        if (text.length <= MAX_SHARE_TEXT_LENGTH) out.text = text;
      }
    }
    if (p.has('k')) {
      // The kit is returned raw; callers pass it through normalizeKit. A
      // broken or overbound kit drops only itself, not the rest of the hash.
      const encoded = p.get('k');
      if (encoded.length <= MAX_SHARE_KIT_PARAM_LENGTH) {
        try {
          const packed = b64urlDecode(encoded);
          if (new TextEncoder().encode(packed).length <= MAX_SHARE_KIT_BYTES) out.kit = JSON.parse(packed);
        } catch { /* ignore bad kit */ }
      }
    }
  } catch {
    return {};
  }
  return out;
}
