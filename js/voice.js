// Quark's voice output.
//
// Natural voice first: when the backend can speak (Gemini text-to-speech, see tts.js) each sentence is played as soon as it is
// ready, through a small "robot pet" sound chain, while the next sentence is already being fetched. If that isn't available
// (no key, busy, slow) Quark falls back to the browser's own voice described below.
//
// Fallback voice: a line is split into short phrases. Each phrase is spoken with speechSynthesis at a high
// pitch and fast rate, and a little chirp plays in the gap between phrases, so it sounds like
// a robot pet babbling rather than a screen reader. Subtitles are always shown.
//
// If speech is unavailable or silently broken (no voices, blocked, sound off), Quark falls back to
// "beeps" (chirps timed to the words) or, with sound off, to silent subtitles at reading speed.

import * as audio from './audio.js';
import { settings } from './storage.js';
import { fill, rand, sleep } from './util.js';

const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

// [pitch, rate] per tone. Pitch is 0..2 in the spec, rate is a speed multiplier.
const TONES = {
  normal: [1.7, 1.2],
  happy: [1.9, 1.28],
  excited: [1.95, 1.36],
  sleepy: [1.25, 0.85],
  sulky: [1.15, 0.9],
  angry: [1.45, 1.3],
  shout: [2, 1.12],
  bored: [1.35, 0.95],
  sad: [1.3, 0.88],
  smug: [1.3, 0.9],       // low, slow and pleased with itself
};

// the emotion a tone stands for, and how much faster or slower each emotion is spoken
const TONE_EMOTION = { normal: 'content', happy: 'happy', excited: 'excited', sleepy: 'sleepy', sulky: 'sulky', angry: 'angry', shout: 'excited', bored: 'bored', sad: 'sad', smug: 'smug' };
const EMOTION_RATE = { happy: 1.04, excited: 1.1, curious: 1.02, content: 1, bored: 0.96, sleepy: 0.92, startled: 1.08, scared: 1.08, sulky: 0.97, sad: 0.94, angry: 1.03, smug: 0.96 };
const wordsOf = (t) => t.split(/\s+/).filter(Boolean).length;

let voices = [];
function loadVoices() { voices = synth ? synth.getVoices() : []; }
if (synth) {
  loadVoices();
  synth.addEventListener?.('voiceschanged', loadVoices);
}

function pickVoice() {
  const en = voices.filter((v) => /^en/i.test(v.lang));
  const local = en.filter((v) => v.localService); // on-device voices start instantly and honour pitch
  const liked = [/samantha/i, /karen/i, /tessa/i, /moira/i, /zira/i, /aria/i, /jenny/i, /female/i, /google uk english female/i, /google us english/i];
  for (const pool of [local, en]) {
    for (const re of liked) {
      const v = pool.find((x) => re.test(x.name));
      if (v) return v;
    }
  }
  return local[0] || en[0] || voices[0] || null;
}

/** Splits a line into phrases: break after punctuation, or after maxWords words. */
export function chunkText(text, maxWords = 4) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  let cur = [];
  words.forEach((w, i) => {
    cur.push(w);
    const hard = /[.!?…;:]["')\]]*$/.test(w);
    const soft = /[,—–-]$/.test(w) && cur.length >= Math.min(3, maxWords);
    const long = cur.length >= maxWords;
    const last = i === words.length - 1;
    if (hard || soft || long || last) {
      // don't strand a single short word at the very end of the line
      if (last && cur.length === 1 && out.length && !hard) out[out.length - 1] += ' ' + cur.join(' ');
      else out.push(cur.join(' '));
      cur = [];
    }
  });
  return out;
}

export function createVoice({ subtitles, getName, tts }) {
  const handlers = {};
  const emit = (name, data) => (handlers[name] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });

  let runId = 0;
  let speaking = false;
  let ttsOK = !!synth;          // flips to false if speech never starts
  let ttsConfirmed = false;     // true once any utterance has actually started
  let ttsRetryAt = 0;           // after a failure, try real speech again later (voices can load late)
  let fallbackTold = false;
  let babbleBase = 1;
  let clip = null;              // the natural-voice clip that is playing right now
  const mul = { pitch: 1, rate: 1 };

  /** 'speech' | 'beeps' | 'silent', from settings and what the browser can do. */
  function mode() {
    if (!settings.get('sound')) return 'silent';
    if (!ttsOK && synth && performance.now() > ttsRetryAt) ttsOK = true;
    if (settings.get('voice') === 'beeps' || !synth || !ttsOK) return 'beeps';
    return 'speech';
  }

  /** Call from a user gesture so iOS/Safari let us talk later. */
  let unlocked = false;
  function unlock() {
    if (!synth || unlocked || speaking) return;   // once is enough; never queue a silent utterance behind real speech
    unlocked = true;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      synth.speak(u);
    } catch { /* ignore */ }
  }

  function cancelSynth() {
    if (!synth) return;
    try { synth.cancel(); } catch { /* ignore */ }
  }

  function speakChunk(text, pitch, rate) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
      u.pitch = Math.min(2, Math.max(0, pitch));
      u.rate = Math.min(3, Math.max(0.4, rate));
      u.volume = 1;
      let done = false;
      let started = false;
      const finish = (spoken) => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        clearTimeout(startWatch);
        resolve(spoken);
      };
      u.onstart = () => { started = true; ttsConfirmed = true; };
      u.onboundary = () => emit('pulse');
      u.onend = () => finish(true);
      u.onerror = () => finish(started);
      const watchdog = setTimeout(() => finish(started), 3000 + text.length * 120);
      // some embedded browsers accept speak() and then never speak; notice, tell the user once, and fall back to beeps
      const startWatch = setTimeout(() => {
        if (!started && !ttsConfirmed) {
          ttsOK = false;
          ttsRetryAt = performance.now() + 45000;
          cancelSynth();
          if (!fallbackTold) { fallbackTold = true; emit('fallback', { reason: 'speech did not start' }); }
          finish(false);
        }
      }, 3500);
      try { synth.resume(); synth.speak(u); } catch { finish(false); }
    });
  }

  /** Robot babble: one blip per syllable, timed roughly like speech. */
  async function babble(text, id, rate) {
    const words = text.split(/\s+/).filter(Boolean);
    for (const w of words) {
      if (id !== runId) return;
      const syl = Math.max(1, Math.round(w.replace(/[^a-z]/gi, '').length / 3));
      for (let s = 0; s < syl; s++) {
        audio.blip(rand(640, 1500) * babbleBase);
        emit('pulse');
        await sleep(82 / rate);
        if (id !== runId) return;
      }
      await sleep(46 / rate);
    }
  }

  /**
   * Start a spoken line that can keep growing: push(text) adds a sentence (or any text) while Quark is already
   * talking, end() says "that's all". A newer stream or say() interrupts this one (done resolves false).
   * opts: tone, emotion, pitch, rate, maxWords, chunk:false, chirps:false, natural (force the natural voice on or off)
   * push(text, spoken) shows `text` in the subtitles and speaks `spoken` (default: the same).
   */
  function stream(opts = {}) {
    const id = ++runId;
    clip?.stop();
    const [p0, r0] = TONES[opts.tone] || TONES.normal;
    const pitch = (opts.pitch ?? p0) * mul.pitch;
    const rate = (opts.rate ?? r0) * mul.rate;
    const emotion = opts.emotion || TONE_EMOTION[opts.tone] || 'content';
    babbleBase = Math.min(1.5, Math.max(0.6, pitch / 1.7));

    cancelSynth();
    subtitles.begin();
    speaking = true;
    emit('start', { text: '' });

    const queue = [];            // sentences waiting to be spoken: { text, clip: Promise<AudioBuffer|null> | null }
    let ended = false;
    let wake = null;
    let said = 0;                // words spoken so far, for the karaoke highlight
    let spokenChunks = 0;
    const nat = () => mode() !== 'silent' && settings.get('voice') !== 'beeps';
    // the natural voice was chosen and there is a backend to speak it: when it is slow or busy Quark babbles in robot chirps
    // and the subtitles carry the words; the browser's own voice is never used (people hate it)
    const strict = () => !!tts && tts.chosen && settings.get('voice') !== 'beeps';
    const wantNatural = (text) => !!tts && nat() && opts.natural !== false && (opts.natural === true || wordsOf(text) >= 3) && tts.ready;

    /** Play one sentence with the natural voice. false = couldn't (use the browser voice for this sentence). */
    async function playNatural(item) {
      const buf = await Promise.race([item.clip, sleep(9000).then(() => null)]);
      if (id !== runId || !buf) return false;
      const speed = Math.min(1.5, Math.max(0.7, (EMOTION_RATE[emotion] || 1) * (Number(settings.get('voiceRate')) || 1)));
      const play = audio.playClip(buf, { rate: speed, robot: Number(settings.get('voiceRobot')) || 0 });
      if (!play) return false;
      clip = play;
      const n = wordsOf(item.text);
      const base = said;
      const t0 = performance.now();
      const timer = setInterval(() => {
        subtitles.progress(base + Math.ceil(Math.min(1, (performance.now() - t0) / 1000 / play.duration) * n));
        if (play.level() > 0.05) emit('pulse');
      }, 70);
      try { await play.done; } finally { clearInterval(timer); if (clip === play) clip = null; }
      if (id !== runId) return true;
      said += n;
      subtitles.progress(said);
      return true;
    }

    // safety net: if whoever started this line never finishes it (an error upstream), end it so the microphone comes back
    let lastActivity = performance.now();
    const watchdog = setInterval(() => { if (!ended && performance.now() - lastActivity > 90000) { ended = true; wake?.(); } }, 5000);

    const done = (async () => {
      const m = mode();
      try {
        for (;;) {
          if (id !== runId) return false;
          if (!queue.length) {
            if (ended) break;
            await new Promise((r) => { wake = r; });
            wake = null;
            continue;
          }
          const item = queue.shift();
          if (item.clip) {
            const played = await playNatural(item);
            if (id !== runId) return false;
            if (played) continue;
          }
          const chunks = opts.chunk === false ? [item.text] : chunkText(item.text, opts.maxWords || 4);
          for (const c of chunks) {
            if (id !== runId) return false;
            if (spokenChunks > 0 && opts.chirps !== false && m !== 'silent') { audio.blip(); await sleep(35); if (id !== runId) return false; }
            spokenChunks++;
            said += wordsOf(c);
            subtitles.progress(said);
            emit('chunk', { text: c, index: spokenChunks - 1, count: 0 });

            if (m === 'silent') {
              await sleep(c.length * 42 + 220);
            } else if (m === 'speech' && !strict()) {
              const spokenOK = await speakChunk(c, pitch, rate);
              if (id !== runId) return false;
              if (!spokenOK && !ttsOK) await babble(c, id, rate); // speech just got ruled out; don't lose the line
            } else {
              await babble(c, id, rate);
            }
          }
        }
        return id === runId;
      } finally {
        clearInterval(watchdog);
        if (id === runId) {
          speaking = false;
          subtitles.finish();
          emit('end');
        }
      }
    })();

    return {
      id,
      done,
      push(text, spoken) {
        if (id !== runId || ended) return;
        lastActivity = performance.now();
        const shown = fill(text, { name: getName() });
        const say = fill(spoken ?? text, { name: getName() });
        subtitles.append(shown);
        // start fetching the natural voice right away; by the time earlier sentences finish, this one is usually ready
        queue.push({ text: say, clip: say.trim() && wantNatural(say) ? tts.get(say, { emotion, intensity: opts.intensity ?? 50 }) : null });
        wake?.();
      },
      end() { ended = true; wake?.(); },
      get live() { return id === runId; },
    };
  }

  /**
   * Say a line. A newer line interrupts an older one (the older promise resolves false).
   * opts: tone, emotion, pitch, rate, spoken (text to speak if different from subtitle), chunk:false, chirps:false, natural
   */
  function say(text, opts = {}) {
    const s = stream(opts);
    s.push(text, opts.spoken);
    s.end();
    return s.done;
  }

  /** Stop talking right now. */
  function cancel() {
    runId++;
    clip?.stop();
    cancelSynth();
    if (speaking) {
      speaking = false;
      subtitles.hide();
      emit('end');
    }
  }

  return {
    say,
    stream,
    cancel,
    unlock,
    mul,
    on(name, fn) { (handlers[name] ||= []).push(fn); },
    get speaking() { return speaking; },
    get mode() { return mode(); },
    get ttsOK() { return ttsOK; },
    get ttsConfirmed() { return ttsConfirmed; },
    get voiceName() { const v = pickVoice(); return v ? `${v.name} (${v.lang})` : synth ? 'default' : 'none'; },
  };
}
