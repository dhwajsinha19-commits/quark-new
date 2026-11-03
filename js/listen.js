// Voice input (Web Speech API SpeechRecognition).
//
//   listenOnce()      tap the mic: capture one utterance, then hand the text over
//   captureLong()     a longer answer (roast battle): keeps listening until you pause for a few seconds or say "done"
//   setHandsFree(on)  "Hey Quark": keep listening for the wake phrase (the robot's current name) and treat whatever
//                     follows as the message. For a while after Quark talks, no wake phrase is needed: it's a conversation.
//
// Privacy rules baked in: nothing listens until the user taps; hands-free only runs while this page
// is visible; recognition is paused whenever Quark is talking (so it never hears itself); and a
// visible mic state is always reported to the UI. Support is patchy (no Firefox, flaky in embedded
// browsers), so every failure reports a notice and the typed input remains the fallback.

import { micEvent, micTranscript } from './debuglog.js';

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

const GREETINGS = new Set(['hey', 'hi', 'hay', 'hei', 'okay', 'ok', 'yo', 'hello', 'oi', 'heya', 'hiya', 'ay']);

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// recognisers often mishear the default name. "strong" mishearings are not ordinary words, so they can wake Quark on their own;
// "weak" ones (work, park, cook...) only count right after "hey", or a sentence that starts with "work" would wake it.
const NAME_ALIASES = {
  quark: {
    strong: ['quark', 'quirk', 'quork', 'kwark', 'qwark', 'kuark', 'quarck'],
    weak: ['quack', 'cork', 'quirky', 'park', 'clark', 'quart', 'work', 'court', 'cook', 'quo'],
  },
};

/**
 * "hey quark what's up" -> { rest: "what's up" }; "quark, how was your day" -> { rest: "how was your day" }.
 * Works for names of several words ("Bolt Jr") because the words are tried in groups of one to three.
 * Returns null if the wake phrase isn't there.
 */
export function matchWake(transcript, name) {
  const words = transcript.toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').split(/\s+/).filter(Boolean);
  const target = String(name || 'quark').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!target) return null;
  const al = NAME_ALIASES[target] || { strong: [], weak: [] };
  const strong = new Set([target, ...al.strong]);
  const weak = new Set(al.weak);
  const close = (w) => (target.length >= 5 && lev(w, target) <= 1) || (target.length >= 4 && w.length >= 4 && lev(w, target) <= 1 && w[0] === target[0]);
  /** How many words starting at i make up the name (0 if none). afterGreeting also allows the weak mishearings. */
  const nameAt = (i, afterGreeting) => {
    for (let k = 1; k <= 3 && i + k <= words.length; k++) {
      const w = words.slice(i, i + k).join('');
      if (strong.has(w) || close(w) || (afterGreeting && weak.has(w))) return k;
    }
    return 0;
  };
  for (let i = 0; i < words.length; i++) {
    if (!GREETINGS.has(words[i])) continue;
    const k = nameAt(i + 1, true);
    if (k) return { rest: words.slice(i + 1 + k).join(' ') };
  }
  // the name on its own at the very start: "Quark, what's up?" (needs something after it, and a name that isn't a tiny word)
  if (words.length > 1 && target.length >= 4) {
    const k = nameAt(0, false);
    if (k) return { rest: words.slice(k).join(' ') };
  }
  return null;
}

// Chrome's recogniser turns words that merely sound like numbers into digits ("fought" -> "14", "ate" -> "8"). It also offers the
// other readings as alternatives, so a short phrase that came back as digits is swapped for a word reading when there is one.
// Number words and their homophones (won, to, for, ate) are not swapped: for those the digits are as likely to be right.
const NUMBER_WORDS = new Set(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million']);
const NUMBER_SOUNDALIKES = new Set(['won', 'to', 'too', 'for', 'fore', 'ate', 'oh']);
const plainWords = (s) => s.toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * res: one SpeechRecognitionResult (alternatives, best first). Returns { text, swapped, numeric }:
 *   text     the transcript to use (the best one, unless it was a bare number and a word reading exists)
 *   swapped  true if a word reading replaced the digits
 *   numeric  true if the phrase is still nothing but a number, so the brain can be told it may be a mis-heard word
 * numbersOk: a game that really takes numbers (chess squares) is running, so digits are left alone.
 */
export function pickTranscript(res, { numbersOk = false } = {}) {
  const top = res[0].transcript;
  const out = { text: top, swapped: false, numeric: false };
  if (numbersOk || !/\d/.test(top)) return out;
  const tw = plainWords(top);
  if (!tw.length || tw.length > 3 || !tw.every((w) => /^\d+(st|nd|rd|th)?$/.test(w))) return out;     // "i have 2" or "i am 14 years old": the number sits in a sentence, leave it
  for (let k = 1; k < res.length; k++) {
    const alt = res[k] && res[k].transcript;
    if (!alt || /\d/.test(alt)) continue;
    const aw = plainWords(alt);
    if (!aw.length || aw.length > tw.length + 1) continue;
    if (aw.every((w) => NUMBER_WORDS.has(w) || NUMBER_SOUNDALIKES.has(w))) continue;
    return { text: (/^\s/.test(top) ? ' ' : '') + alt.trim(), swapped: true, numeric: false };
  }
  out.numeric = true;                                               // nothing but a number, and no word reading to put in its place
  return out;
}

/** "...that's my roast, done" -> "...that's my roast" */
const DONE_RE = /[\s,.!?]*\b(?:i'?m |that'?s it,? |all )?(?:done|finished|over)\b[\s.!?]*$/i;

export function createListener({ getName, isSpeaking, isConversing, wantsNumbers, getLang, onInterim, onFinal, onWake, onState, onNotice, onNoSpeech }) {
  let supported = !!SR;
  let rec = null;
  let kind = null;            // 'once' | 'wake' while a recogniser is running
  let handsFree = false;
  let wantOnce = false;       // start a one-shot as soon as Quark stops talking
  let denied = false;
  let errorStreak = 0;
  let restartTimer = 0;
  let heardFinal = '';
  let heardConf = null;       // lowest confidence among the finished phrases (null = the browser didn't say)
  let heardAlts = [];         // other transcripts the recogniser considered for the last phrase
  let heardNumeric = false;   // the last phrase is only a number (it may be a word the recogniser heard as one)
  let long = null;           // finish() of a running captureLong
  let startTries = 0;         // how many times in a row the browser refused to start listening
  let lastResultAt = 0;       // when the recogniser last reported anything (for the debug panel's "hearing" state)
  let state = supported ? 'idle' : 'unsupported';

  const heardInfo = () => ({ confidence: heardConf, alternatives: heardAlts.slice(0, 3), numeric: heardNumeric });
  const setState = (s) => { if (s !== state) { state = s; onState?.(s); } };
  const effectiveState = () => (denied ? 'denied' : !supported ? 'unsupported' : kind === 'once' ? 'listening' : handsFree ? 'hands-free' : 'idle');
  const refreshState = () => setState(effectiveState());

  // the accent the recogniser is asked for: the one picked in Settings, else the browser's own English, else US English
  const lang = () => {
    const pick = getLang && getLang();
    if (pick && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(pick)) return pick;
    return /^en/i.test(navigator.language || '') ? navigator.language : 'en-US';
  };

  function stopRec() {
    clearTimeout(restartTimer);
    if (long) { const f = long; long = null; f(); }
    const r = rec;
    rec = null;
    kind = null;
    if (r) {
      r.onresult = r.onerror = r.onend = r.onstart = null;
      try { r.abort(); } catch { /* ignore */ }
    }
  }

  function start(which) {
    if (!supported || denied) return false;
    stopRec();
    heardFinal = '';
    heardConf = null;
    heardAlts = [];
    heardNumeric = false;
    const r = new SR();
    r.lang = lang();
    r.continuous = which === 'wake';
    r.interimResults = true;
    r.maxAlternatives = 5;
    rec = r;
    kind = which;
    micEvent('start', which);
    let handled = false;
    let failed = false;         // an error ended this session (so "no words heard" is not the right thing to say)

    r.onstart = () => { errorStreak = 0; startTries = 0; micEvent('onstart', which); refreshState(); };

    r.onresult = (e) => {
      let interim = '';
      let finals = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          const pick = pickTranscript(res, { numbersOk: !!(wantsNumbers && wantsNumbers()) });
          const txt = pick.text;
          if (pick.swapped) micEvent('number-fix', `"${res[0].transcript.trim()}" -> "${txt.trim()}"`);
          finals += txt;
          heardNumeric = pick.numeric;
          const c = res[0].confidence;
          if (c > 0) heardConf = heardConf == null ? c : Math.min(heardConf, c);   // 0 means "not provided"
          heardAlts = [];
          for (let k = 0; k < res.length; k++) {
            const a = res[k].transcript && res[k].transcript.trim();
            if (a && a !== txt.trim() && !heardAlts.includes(a)) heardAlts.push(a);
          }
        } else interim += res[0].transcript;
      }
      lastResultAt = Date.now();
      if (interim) micTranscript('interim', interim.trim());
      if (finals) { micTranscript('final', finals.trim()); micEvent('final', `"${finals.trim()}"${heardConf != null ? ` (${Math.round(heardConf * 100)}%)` : ''}`); }
      if (which === 'once') {
        if (finals) heardFinal += finals;
        onInterim?.((heardFinal + interim).trim(), false);
        if (finals) { handled = true; try { r.stop(); } catch { /* ignore */ } }
        return;
      }
      // wake mode: ambient speech is never shown or kept; only a finished phrase that starts with the wake phrase matters,
      // or, for a little while after Quark has been talking, anything you say (that is just a conversation)
      if (!finals) return;
      const m = matchWake(finals, getName());
      if (m) {
        handled = true;
        stopRec();
        onWake?.(m.rest);
      } else if (isConversing?.() && finals.trim().split(/\s+/).length >= 2) {
        handled = true;
        const heard = heardInfo();
        stopRec();
        onWake?.(finals.trim(), heard);
      }
    };

    r.onerror = (e) => {
      const err = e.error;
      micEvent('error', err, err === 'no-speech' || err === 'aborted' ? 'warn' : 'error');
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        denied = true;
        handsFree = false;
        onNotice?.("I can't use the microphone. Allow it in your browser, or just type to me.");
      } else if (err === 'audio-capture') {
        supported = false;
        onNotice?.("I can't find a microphone. You can type to me instead.");
      } else if (err === 'network') {
        // the browser's speech service is unreachable for a moment: back off and try again, don't give up for good
        errorStreak++;
        failed = true;
        if (which === 'once') onNotice?.("The browser's speech service didn't answer. Tap the mic to try again, or type to me.");
        else if (errorStreak >= 4) {
          handsFree = false;
          onNotice?.("Voice listening can't reach its speech service right now. Tap the mic to try again, or type to me.");
        }
      } else if (err !== 'no-speech' && err !== 'aborted') {
        errorStreak++;
      }
    };

    r.onend = () => {
      if (rec !== r) return; // replaced or stopped on purpose
      micEvent('onend', which);
      rec = null;
      kind = null;
      if (which === 'once') {
        const text = heardFinal.trim();
        refreshState();
        if (text) onFinal?.(text, heardInfo());
        else if (!handled && !failed) onNoSpeech?.();      // nothing was heard at all: no words, just a puzzled look (see chat-ui.js)
      }
      refreshState();
      scheduleResume(errorStreak > 0 ? Math.min(6000, 600 * 2 ** errorStreak) : 350);
    };

    try {
      r.start();
    } catch {
      // "already started" and friends: drop this recogniser; resume() builds a fresh one and tries again
      micEvent('start failed', 'the browser refused to start listening', 'error');
      rec = null;
      kind = null;
      return false;
    }
    refreshState();
    return true;
  }

  function scheduleResume(ms) {
    clearTimeout(restartTimer);
    restartTimer = setTimeout(resume, ms);
  }

  /** Decide what (if anything) should be listening right now. */
  function resume() {
    if (!supported || denied || document.hidden || rec) return;
    if (isSpeaking?.()) { micEvent('resume skipped', 'Quark is talking'); return; }   // stay quiet, we'll be told when it ends
    if (errorStreak >= 4) { handsFree = false; refreshState(); return; }
    if (wantOnce) {
      wantOnce = false;
      if (!start('once')) {
        // the browser wouldn't start listening ("already started" and friends): try again a couple of times, then say so
        if (++startTries < 3) { wantOnce = true; scheduleResume(400); }
        else { startTries = 0; onNotice?.("I couldn't start listening. Tap the mic again, or type to me."); }
      }
      return;
    }
    if (handsFree) start('wake');
  }

  /**
   * Listen for a longer answer. Resolves with what was said once you pause for `pauseMs` or say "done"; resolves '' if
   * nothing was said in `maxMs` or the microphone can't be used.
   */
  function captureLong({ pauseMs = 2500, maxMs = 45000, onInterim: onText } = {}) {
    return new Promise((resolve) => {
      if (!supported || denied) { resolve(''); return; }
      stopRec();
      const r = new SR();
      r.lang = lang();
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      rec = r;
      kind = 'once';
      let text = '';
      let timer = 0;
      let finished = false;
      const t0 = Date.now();
      const current = () => text.replace(/\s+/g, ' ').trim();
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        clearTimeout(maxTimer);
        if (long === finish) long = null;
        if (rec === r) { rec = null; kind = null; }
        r.onresult = r.onerror = r.onend = r.onstart = null;
        try { r.abort(); } catch { /* ignore */ }
        refreshState();
        micTranscript('final', current().replace(DONE_RE, '').trim());
        micEvent('long answer done', `"${current().replace(DONE_RE, '').trim().slice(0, 80)}"`);
        resolve(current().replace(DONE_RE, '').trim());
      };
      const maxTimer = setTimeout(finish, maxMs);
      long = finish;
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { if (current()) finish(); }, pauseMs);
      };
      micEvent('start', 'long answer');
      r.onstart = () => { errorStreak = 0; micEvent('onstart', 'long answer'); refreshState(); };
      r.onresult = (e) => {
        text = '';
        lastResultAt = Date.now();
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript + ' ';
        micTranscript('interim', current());
        onText?.(current().replace(DONE_RE, ''));
        if (DONE_RE.test(current())) { finish(); return; }
        arm();
      };
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { denied = true; onNotice?.("I can't use the microphone. Allow it in your browser, or just type to me."); finish(); }
        else if (e.error === 'audio-capture') { supported = false; finish(); }
      };
      r.onend = () => {
        if (finished) return;
        // Chrome ends a session after a long silence: start again until the time is up
        if (Date.now() - t0 < maxMs && !current()) { try { r.start(); return; } catch { /* fall through */ } }
        finish();
      };
      try { r.start(); } catch { finish(); return; }
      refreshState();
    });
  }

  return {
    get supported() { return supported; },
    get state() { return state; },
    get handsFree() { return handsFree; },
    get denied() { return denied; },

    /** Capture one utterance. If Quark is mid-sentence, waits for the end. */
    listenOnce() {
      if (!supported || denied) { onNotice?.(denied ? "The microphone is blocked. Type to me instead!" : "I can't hear in this browser. Type to me instead!"); return false; }
      wantOnce = true;
      errorStreak = 0;                        // a deliberate tap always gets a fresh try
      if (isSpeaking?.()) return true;
      stopRec();
      resume();
      return true;
    },
    captureLong,
    stop() {
      wantOnce = false;
      stopRec();
      refreshState();
    },
    /** For the debug panel: what the recogniser is doing right now. */
    debug() {
      const speaking = !!isSpeaking?.();
      const hearing = lastResultAt && Date.now() - lastResultAt < 1500;
      const recState = !SR ? 'unsupported' : !supported ? 'error' : denied ? 'denied' : speaking ? 'speaking-paused' : rec ? (hearing ? 'hearing' : 'listening') : restartTimer ? 'starting' : 'idle';
      return { recState, kind, handsFree, wantOnce, errorStreak, startTries, supported, denied, hasSR: !!SR, lang: lang(), hidden: typeof document !== 'undefined' && document.hidden };
    },
    setHandsFree(on) {
      micEvent('hands-free', on ? 'on' : 'off');
      if (on && (!supported || denied)) { onNotice?.(denied ? "The microphone is blocked. Allow it and try again." : "I can't hear in this browser. Type to me instead!"); return false; }
      handsFree = !!on;
      if (!on && kind === 'wake') stopRec();
      refreshState();
      if (on) { errorStreak = 0; resume(); }
      return true;
    },
    /** Call when Quark starts talking: drop the mic so it can't hear itself. */
    speechStarted() {
      micEvent('paused', 'Quark started talking');
      clearTimeout(restartTimer);
      if (rec && !long) { const was = kind; stopRec(); if (was === 'once') wantOnce = true; }
      refreshState();
    },
    /** Call when Quark stops talking. */
    speechEnded() { micEvent('speech ended', 'resuming in 500 ms'); scheduleResume(500); },
    /** Nudge: if hands-free (or a pending one-shot) should be listening but isn't, start it. */
    kick() { scheduleResume(300); },
    pageHidden() { micEvent('page hidden', 'listening stopped', 'warn'); stopRec(); refreshState(); },
    pageVisible() { micEvent('page visible', 'resuming'); scheduleResume(300); },
    allowRetry() { denied = false; errorStreak = 0; supported = !!SR; refreshState(); },
  };
}
