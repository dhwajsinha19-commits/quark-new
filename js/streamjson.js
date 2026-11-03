// Reads Quark's JSON reply while it is still being written, so speech can start before the model has finished.
// (The server does this for Gemini; the on-device model streams straight into the browser, so it needs its own copy.)
//
// The model writes the keys in a fixed order: emotion, intensity, gesture, reply, memory_update. So the face can react
// first (meta), then the reply text arrives in pieces (delta), then everything else (final).

import { EMOTIONS, GESTURES, SOUNDS } from './moods.js';

const ESC = { n: '\n', t: '\t', '"': '"', '\\': '\\', '/': '/', r: '', b: '', f: '' };

/** Feed it the whole JSON text so far, every time it grows. It returns only what's new. */
export class ReplyStream {
  constructor() {
    this.i = -1;
    this.done = false;
    this.metaSent = false;
  }

  /** Newly decoded characters of the "reply" string. */
  feed(full) {
    if (this.i < 0) {
      const m = /"reply"\s*:\s*"/.exec(full);
      if (!m) return '';
      this.i = m.index + m[0].length;
    }
    let out = '';
    let i = this.i;
    while (i < full.length && !this.done) {
      const c = full[i];
      if (c === '\\') {
        if (i + 1 >= full.length) break;
        const n = full[i + 1];
        if (n === 'u') {
          if (i + 6 > full.length) break;
          const code = parseInt(full.slice(i + 2, i + 6), 16);
          if (!Number.isNaN(code)) out += String.fromCharCode(code);
          i += 6;
        } else {
          out += ESC[n] ?? n;
          i += 2;
        }
      } else if (c === '"') {
        this.done = true;
        i += 1;
      } else {
        out += c;
        i += 1;
      }
    }
    this.i = i;
    return out;
  }

  /** emotion/intensity/gesture, once, as soon as the model has written them. */
  meta(full) {
    if (this.metaSent) return null;
    const em = /"emotion"\s*:\s*"([a-z_]+)"/.exec(full);
    const it = /"intensity"\s*:\s*(\d+)\s*[,}]/.exec(full);   // wait for the delimiter: "7" may still become "72"
    if (!em || !it) return null;
    const gs = /"gesture"\s*:\s*"([a-z_]+)"/.exec(full);
    const sd = /"sound"\s*:\s*"([a-z_]+)"/.exec(full);
    if (!(gs && sd) && !/"reply"\s*:/.test(full)) return null;   // gesture and sound are written right after intensity: wait for them
    this.metaSent = true;
    return {
      emotion: EMOTIONS.includes(em[1]) ? em[1] : 'content',
      intensity: Math.max(0, Math.min(100, +it[1])),
      gesture: gs && GESTURES.includes(gs[1]) ? gs[1] : 'none',
      sound: sd && SOUNDS.includes(sd[1]) ? sd[1] : 'none',
    };
  }
}

/** The finished JSON, coerced into the exact contract (same rules as the server's validate()). */
export function validateReply(obj) {
  if (!obj || typeof obj !== 'object') obj = { reply: String(obj || '') };
  const mu = obj.memory_update && typeof obj.memory_update === 'object' ? obj.memory_update : {};
  const num = Number(obj.intensity);
  return {
    emotion: EMOTIONS.includes(obj.emotion) ? obj.emotion : 'content',
    intensity: Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : 40,
    gesture: GESTURES.includes(obj.gesture) ? obj.gesture : 'none',
    sound: SOUNDS.includes(obj.sound) ? obj.sound : 'none',
    reply: String(obj.reply || ''),
    memory_update: {
      summary: String(mu.summary || '').slice(0, 700),
      facts_add: (Array.isArray(mu.facts_add) ? mu.facts_add : []).map((s) => String(s).slice(0, 100)).filter(Boolean).slice(0, 3),
      name: String(mu.name || '').slice(0, 24),
      topic: String(mu.topic || '').slice(0, 40),
    },
  };
}

/** Parse the complete text, recovering what it can if the stream was cut off. */
export function parseFinal(full) {
  try { return JSON.parse(full); } catch { /* fall through */ }
  const m = /\{[\s\S]*\}/.exec(full);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  const rs = new ReplyStream();
  const reply = rs.feed(full);
  const meta = new ReplyStream().meta(full) || {};
  return { ...meta, reply };
}

/**
 * Splits a growing piece of text into sentences. push(text) returns the sentences that are now complete (it holds back
 * the tail until it has seen what follows the punctuation, so "Dr. Smith" and "...okay" aren't cut in half).
 * end() returns whatever is left.
 */
export function createSentenceSplitter() {
  let buf = '';
  const boundary = /([.!?…]+["')\]]*)(\s+)(?=["'(\[]?[A-Z0-9])/g;
  return {
    push(text) {
      buf += text;
      const out = [];
      let last = 0;
      let m;
      boundary.lastIndex = 0;
      while ((m = boundary.exec(buf))) {
        const end = m.index + m[1].length;
        const piece = buf.slice(last, end).trim();
        // "Hmm..." followed by a capital is a real boundary; "Dr." or an initial like "J." is not ("Ok." and "Hi." are)
        if (piece && !/(^|\s)(?:[A-Z]|Dr|Mr|Mrs|Ms|St|Jr|Sr|Mt|vs|etc|e\.g|i\.e)\.$/.test(piece)) { out.push(piece); last = m.index + m[0].length; }
      }
      buf = buf.slice(last);
      return out;
    },
    end() {
      const rest = buf.trim();
      buf = '';
      return rest ? [rest] : [];
    },
    get pending() { return buf; },
  };
}
