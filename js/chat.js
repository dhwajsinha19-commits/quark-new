// Conversation. Every message goes to the AI brain, together with what it needs to sound like a friend who remembers:
// the last 10 to 15 turns, a rolling memory summary, Quark's current emotion, the time of day, how long you were quiet,
// and short hints about what just happened (waved, picked up...). There are no canned replies.
//
// The reply streams back as it is written. The face reacts to the emotion first, then Quark starts speaking on the
// first complete sentence while the rest is still arriving, and the memory update is applied at the end.

import { CONFIG } from './config.js';
import { memory } from './memory.js';
import { converse, cleanReply } from './brain.js';
import { whenText } from './geminikey.js';
import { createSentenceSplitter } from './streamjson.js';
import { createVariety } from './variety.js';
import { matchWake } from './listen.js';
import { sleep } from './util.js';

/** "let's play rock paper scissors", "play chess"... -> a game id, or null. */
export function detectGameIntent(low) {
  const play = /\b(play|start|let'?s|lets|wanna|want to|challenge|open|launch|begin|another|rematch|new game)\b/.test(low);
  if (/\b(rock[ ,-]*paper[ ,-]*scissors?|rps)\b/.test(low)) return 'rps';
  if (/\bchess\b/.test(low) && (play || /^chess\b/.test(low))) return 'chess';
  if (/\broast (battle|fight|off|contest)\b|\bbattle me\b|\broast each other\b/.test(low)) return 'roast';
  if (/\btap (challenge|game|test|speed)\b|\bhow fast can i tap\b|\btapping (game|challenge)\b/.test(low)) return 'tap';
  return null;
}

const GO_HOME = /\b(go home|home screen|main menu|back to (the )?(home|menu)|exit game|quit game|stop playing)\b/;

// The one fixed message in this file. It is not conversation: it is the safety net for a person in distress when there
// is no brain to answer, so that the worst moment is never met with silence.
const CRISIS_RE = /\b(kill myself|killing myself|end my life|want to die|wanna die|don'?t want to (live|be alive)|suicid|hurt myself|harm myself|cut myself|self[- ]harm)\b/i;
const CRISIS_MSG = "I'm really glad you told me. You matter. I'm only a little robot, so please reach out to someone you trust right now, or call your local emergency number or crisis line.";

const MAX_FOLLOWUPS = 4; // after a spoken question, keep the mic open for a few follow-ups, then stop

function timeInfo() {
  const d = new Date();
  const h = d.getHours();
  const part = h < 5 ? 'late night' : h < 9 ? 'early morning' : h < 12 ? 'morning' : h < 14 ? 'midday' : h < 18 ? 'afternoon' : h < 22 ? 'evening' : 'night';
  return { clock: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), weekday: d.toLocaleDateString([], { weekday: 'long' }), part };
}

function ago(ms) {
  const m = Math.round(ms / 60000);
  if (m < 2) return 'a moment';
  if (m < 90) return `${m} minutes`;
  const h = Math.round(m / 60);
  if (h < 36) return `about ${h} hours`;
  return `about ${Math.round(h / 24)} days`;
}

export function createChat(q) {
  const { face, audio, subtitles } = q;
  const variety = createVariety();
  let token = 0;
  let ctl = null;                  // aborts the request that is in flight
  let inflight = null;             // the reply being spoken right now: { spoken, stored }
  let followUps = 0;
  let offlineToldAt = 0;
  let lastReplyAt = 0;             // when Quark last finished talking: for a while after, no wake phrase is needed
  let phase = 'idle';              // 'thinking' (asked the brain, nothing said yet) | 'speaking' | 'idle'
  let busy = false;                // a message is being handled (thinking or speaking)
  let busyText = '';               // what it said, so a repeat ("hello", "hello", "HELLO") can be recognised
  const queued = [];               // messages that arrived while Quark was still thinking: answered in order, never thrown away
  const hints = [];
  const status = { source: '-', ms: 0, error: '' };

  const kid = () => q.profile.kid;

  function freshHints() {
    const cut = Date.now() - CONFIG.chat.hintMaxAgeMs;
    while (hints.length && hints[0].at < cut) hints.shift();
    // in Kid mode nothing the camera noticed leaves the device, not even as a word
    return hints.filter((h) => !(kid() && h.source === 'camera')).map((h) => h.t).slice(-4);
  }

  /** Short text only, e.g. "user waved". Rides along with the next message; no camera data ever does. */
  function addHint(text, source = 'game') {
    hints.push({ t: String(text).slice(0, 80), at: Date.now(), source });
    if (hints.length > 6) hints.shift();
  }

  function buildRequest({ message = '', event = '', heard = null, silence = memory.silenceSec } = {}) {
    const k = kid();
    return {
      message,
      event,
      heard: heard || undefined,
      history: memory.recent(k ? 10 : CONFIG.chat.historyTurns),
      hints: freshHints(),
      context: {
        robotName: q.name(),
        userName: memory.userName,
        mode: k ? 'kid' : 'adult',
        focus: q.profile.focus,
        time: timeInfo(),
        emotion: q.emotion.snapshot,
        silenceSec: silence,
        summary: memory.summary,
        facts: k ? [] : memory.facts,
        topic: memory.topic,
        game: q.game ? q.game.title : '',
        recentLines: variety.recentLines(8),
        petNamesUsed: variety.petNamesUsed,
      },
    };
  }

  function startThinking() {
    face.express('curious', { key: 'chat' });
    if (!q.mood.is('sulky')) face.lookAt(-0.55, -0.7, { prio: 2 });
    const t = setTimeout(() => audio.chirp('huh'), 350);
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(t);
      face.release('chat');
      if (!q.mood.is('sulky')) face.releaseGaze(2);
      else face.lookAt(-0.95, 0.6, { prio: 2 });
    };
  }

  /** The face and glow follow the emotion the brain reports. A small flourish only when the feeling really changed. */
  function applyEmotion(m) {
    const before = q.emotion.snapshot;
    m = q.temper ? q.temper.filterBrain(m) : m;                              // no whiplash: a fresh anger cools to sulky first
    q.emotion.set(m.emotion, m.intensity, 'chat');
    const changed = before.name !== m.emotion || Math.abs(before.intensity - m.intensity) >= 20;
    if (!changed) return;
    if (m.emotion === 'excited') face.impulse(0, -8, 0.03);                 // a little hop, no sparkles
    else if (m.emotion === 'startled') face.burst('exclaim');
    else if (m.emotion === 'scared') face.burst('sweat');
    else if (m.emotion === 'sad' && m.sound === 'none') audio.chirp('sad');
    else if (m.emotion === 'angry' && m.sound === 'none') audio.chirp('angry');
  }

  /** There is no brain, or it failed. Say so plainly, as a notice (not in Quark's voice), and never pretend to chat. */
  function failure(result, req, turn) {
    const k = kid();
    if (req.message && CRISIS_RE.test(req.message)) {
      if (turn) turn.notice = 'crisis safety message (fixed text) spoken because no brain answered';
      q.say(CRISIS_MSG, { tone: 'sad' });
      return;
    }
    const msg = {
      offline: k ? "My thinking brain is switched off right now. Ask a grown-up to check Settings." : "My brain isn't connected, so I can't chat yet. Open Settings > Brain and paste a free Gemini key.",
      badkey: k ? "My thinking brain needs a grown-up to check Settings." : "Google didn't accept my Gemini key. Check it in Settings > Brain.",
      quota: result.resetAt
        ? (k ? `I've used up my thinking for today. Try me again ${whenText(result.resetAt)}!` : `I've used up my free thinking for today. It's back ${whenText(result.resetAt)}, or paste another key in Settings > Brain.`)
        : "I've used up my free thinking for now. Try me again a bit later.",
      rate: result.retrySec && result.retrySec <= 120 ? `We've been chatting a lot! Give me about ${result.retrySec} seconds.` : "We've been chatting a lot! Give me a minute to catch my breath.",
      blocked: k ? "I can't talk about that one. Ask me something else?" : "That one got blocked. Try asking it a different way?",
      empty: "My thoughts came out blank. Try me again?",
      upstream: "I couldn't reach my brain just now. Try again in a moment.",
    }[result.error] || "I couldn't reach my brain just now.";
    if (result.error === 'offline') {
      if (Date.now() - offlineToldAt < 20000) return;   // already said; don't nag on every message
      offlineToldAt = Date.now();
    }
    if (turn) turn.notice = msg;
    subtitles.notice(msg, 7000);
    audio.chirp('sad');
    face.express('sad', { ms: 1500, key: 'chat' });
  }

  /** Stop whatever reply is in flight. What Quark had already said is kept in the history, in the right order. */
  function interrupt() {
    ctl?.abort();
    const s = inflight;
    inflight = null;
    if (s && s.spoken && !s.stored) { s.stored = true; memory.pushTurn('quark', s.spoken); variety.record(s.spoken); }
  }

  /**
   * Send a request to the brain and speak the reply as it streams in. Used for things the user said and for events
   * Quark reacts to by itself (waking up). Resolves { ok, final?, spoken }.
   */
  async function respond(req, { mine, onFirstSpeech } = {}) {
    interrupt();
    const my = (ctl = new AbortController());
    const state = (inflight = { spoken: '', stored: false });
    const stopThinking = startThinking();
    const splitter = createSentenceSplitter();
    let speaker = null;
    let gesture = 'none';
    let gestured = false;
    let sound = 'none';
    let soundPlayed = false;
    let metaApplied = false;

    const playGesture = () => { if (!gestured && gesture !== 'none') { gestured = true; q.gesture?.(gesture); } };
    const playSound = () => { if (!soundPlayed && sound !== 'none') { soundPlayed = true; q.gesture?.sound?.(sound); } };

    let dropped = 0;                 // sentences the variety filter removed (a repeated catchphrase)
    let rewritten = 0;               // sentences it changed (a repeated pet name taken out)
    const speakSentence = (raw) => {
      if (mine !== token) return;
      const cleaned = cleanReply(raw);
      const s = variety.filterSentence(cleaned);
      if (!s) { if (cleaned) dropped++; return; }
      if (s !== cleaned) rewritten++;
      if (!speaker) {
        phase = 'speaking';
        stopThinking();
        speaker = q.voice.stream({ tone: q.emotion.tone(), emotion: q.emotion.name, intensity: q.emotion.intensity, maxWords: 8, natural: true });
        onFirstSpeech?.();
        playGesture();
        playSound();
      }
      state.spoken += (state.spoken ? ' ' : '') + s;
      speaker.push(s);
    };

    let result;
    phase = 'thinking';
    // an honest word if the brain is slow, so it never feels like the message was lost
    const slowTimer = setTimeout(() => { if (phase === 'thinking' && !speaker && mine === token) subtitles.notice(kid() ? 'Hang on, thinking…' : 'One sec, my brain is slow today…', 9000); }, 5000);
    try {
      result = await converse(req, {
        signal: my.signal,
        onMeta: (m) => { if (mine === token) { metaApplied = true; gesture = m.gesture || 'none'; sound = m.sound || 'none'; applyEmotion(m); } },
        onDelta: (t) => { for (const s of splitter.push(t)) speakSentence(s); },
      });
    } catch (e) {
      console.error(e);
      result = { ok: false, error: 'upstream', source: 'none', ms: 0 };
    } finally {
      clearTimeout(slowTimer);
      stopThinking();
      phase = state.spoken ? 'speaking' : 'idle';
    }
    const turn = result.turn;
    if (result.fellBack && mine === token) subtitles.caption("(Gemini isn't answering, so that was the small on-device AI)", 5000);
    status.source = result.source;
    status.ms = result.ms;
    status.error = result.ok ? '' : result.error;

    if (mine !== token || result.error === 'aborted') {
      phase = 'idle';
      if (turn) turn.fallback = 'interrupted by a newer message';
      speaker?.end();
      if (state.spoken && !state.stored) { state.stored = true; memory.pushTurn('quark', state.spoken); variety.record(state.spoken); }   // keep what it did say
      return { ok: false, error: 'aborted', spoken: state.spoken };
    }
    if (!result.ok) {
      speaker?.end();
      if (state.spoken && !state.stored) { state.stored = true; memory.pushTurn('quark', state.spoken); variety.record(state.spoken); }
      else if (!state.spoken) failure(result, req, turn);
      phase = 'idle';
      return { ...result, spoken: state.spoken };
    }

    const f = result.final;
    for (const s of splitter.end()) speakSentence(s);
    if (!state.spoken && f.reply) {
      // the brain sent the reply only at the end (no streaming): speak it now
      const sp = createSentenceSplitter();
      for (const s of [...sp.push(f.reply + ' '), ...sp.end()]) speakSentence(s);
    }
    if (!metaApplied) applyEmotion(f);               // a brain that doesn't stream still reports its emotion
    if (!gesture || gesture === 'none') gesture = f.gesture || 'none';
    if (!sound || sound === 'none') sound = f.sound || 'none';
    playGesture();
    playSound();                                      // for a reaction without words this is the whole answer: a noise and a movement
    state.stored = true;
    const kept = f.reply || `(no words, just ${[f.sound !== 'none' && `a ${f.sound} sound`, f.gesture !== 'none' && f.gesture].filter(Boolean).join(' and ') || 'a look'})`;
    memory.pushTurn('quark', kept);
    if (f.reply) variety.record(state.spoken || f.reply);
    memory.applyUpdate(f.memory_update, { kid: kid() });
    speaker?.end();
    if (speaker) await speaker.done;
    if (mine === token) { await sleep(300); if (mine === token) face.release('chat'); }
    if (inflight === state) inflight = null;
    lastReplyAt = Date.now();
    phase = 'idle';
    if (turn) Object.assign(turn, { spoken: state.spoken, variety: { dropped, rewritten } });
    return { ok: true, final: f, spoken: state.spoken };
  }

  /**
   * Handle one thing the user said. source: 'voice' | 'text'. heard: { confidence, alternatives } from speech recognition.
   * Resolves once Quark has finished answering.
   */
  const sameText = (a, b) => {
    const n = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    const x = n(a), y = n(b);
    const greeting = /^(hi|hey|hello|hiya|yo|heya|sup|hey there|hi there)$/;
    return x === y || (greeting.test(x) && greeting.test(y));
  };
  /** Instant "I heard you" that costs nothing: a blink and a tiny nod. */
  const acknowledge = () => { face.blink(); face.impulse(0, 3, 0); };

  async function send(raw, opts = {}) {
    let text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!text) return;
    const wake = matchWake(text, q.name());       // "hey quark, what's up" typed or spoken
    if (wake && wake.rest) text = wake.rest;
    // Quark is still working on the last message (it has not started talking): don't throw that work away.
    // A repeat ("hello", "hello", "HELLO") is the same message, so it is ignored; anything new waits its turn.
    if (busy && phase !== 'speaking' && !q.game) {
      acknowledge();
      subtitles.heard(text);
      if (!sameText(text, busyText) && !queued.some((m) => sameText(m.text, text))) queued.push({ text, opts });
      return;
    }
    busy = true;
    busyText = text;
    try {
      await sendNow(text, opts);
    } finally {
      busy = false;
      busyText = '';
      phase = phase === 'thinking' ? 'idle' : phase;
    }
    const next = queued.shift();
    if (next) await send(next.text, next.opts);
  }

  async function sendNow(text, { source = 'text', heard = null } = {}) {
    acknowledge();
    const mine = ++token;
    interrupt();
    if (source === 'text') followUps = 0;

    q.idle.poke();
    q.hint(null);
    q.voice.cancel();                              // talking over Quark interrupts it
    q.listen?.stop?.();
    subtitles.heard(text);

    const low0 = text.toLowerCase();
    if (q.router && GO_HOME.test(low0)) { q.router.go('home'); return; }
    // a game in progress gets first refusal (chess moves, roast answers, "rock"...)
    if (q.game && q.game.handleText && q.game.handleText(text, source)) return;
    q.temper?.onUserText(text);                    // an insult, an apology or "you win" changes how Quark feels before it answers
    const gameId = q.router && detectGameIntent(low0);
    if (gameId && !(q.game && q.game.id === gameId)) { q.router.go('game', { id: gameId }); return; }
    if (q.state.asleep) {
      await q.reactions.wake('quiet');
      if (mine !== token) return;
    }

    memory.markSeen();
    const silence = memory.silenceSec;              // read before this message resets it
    memory.pushTurn('user', text);
    await respond(buildRequest({ message: text, heard: usableHeard(heard), silence }), { mine });
    if (mine !== token) return;

    // a spoken exchange keeps the mic open for a follow-up, so it feels like a conversation (never in focus mode)
    if (source === 'voice' && !q.profile.focus && q.listen && q.listen.supported && followUps < MAX_FOLLOWUPS) {
      followUps++;
      q.listen.listenOnce();
    }
  }

  function usableHeard(h) {
    if (!h) return null;
    const conf = typeof h.confidence === 'number' && h.confidence > 0 ? h.confidence : null;
    const alternatives = (h.alternatives || []).filter(Boolean).slice(0, 3);
    return conf == null && !alternatives.length && !h.numeric ? null : { confidence: conf ?? undefined, alternatives, numeric: h.numeric ? true : undefined };
  }

  /**
   * Quark reacts to something on its own: it just woke up, or a moment happened. The brain writes what it says.
   * Resolves { ok, final?, spoken }; when there is no brain it shows the offline notice instead.
   */
  async function event(text, { onFirstSpeech } = {}) {
    const mine = ++token;
    return respond(buildRequest({ event: String(text).slice(0, 300) }), { mine, onFirstSpeech });
  }

  /** Quark wakes up: introduces itself the first time ever, otherwise a natural hello that can pick up from last time. */
  async function greet({ onFirstSpeech } = {}) {
    if (q.profile.focus && memory.firstMet) return { ok: true, spoken: '' };     // a focus buddy doesn't chatter when it wakes
    const first = !memory.firstMet;
    const away = memory.lastSeen ? Date.now() - memory.lastSeen : 0;
    const topic = memory.recentTopic();
    const ev = first
      ? "You have just woken up on this person's screen and you are meeting them for the first time. Say a short, natural hello (one sentence, no speech, do not announce who or what you are) and ask what they would like to be called."
      : `You have just woken up on the user's screen. You last saw them ${ago(away)} ago. Greet them like a friend who is seeing them again: one short, casual sentence, no "welcome back" speech, no questions about their plans.${topic ? ` Last time you talked about "${topic}"; mention it only if that feels natural.` : ''}`;
    return event(ev, { onFirstSpeech });
  }

  /**
   * A one-line reaction to a game moment. The brain writes it; if there is no brain, the game's own line is used.
   * Resolves { reply, mood }. (The caller speaks it, so it can time the line with what is on screen.)
   */
  async function banter(eventText, fallback, mood = 'playful') {
    const result = await converse(buildRequest({ event: String(eventText).slice(0, 300) }));
    if (result.ok) {
      const reply = variety.filterSentence(cleanReply(result.final.reply));
      if (reply) { variety.record(reply); return { reply, mood: result.final.emotion }; }
      if (result.turn) result.turn.fallback = "the variety filter dropped the AI's line: the game's own stock line was used";
    } else if (result.turn) {
      result.turn.fallback = `${result.turn.fallback || 'the call failed'}; the game's own stock line was used`;
    }
    return { reply: typeof fallback === 'function' ? fallback() : fallback, mood };
  }

  return {
    send, event, greet, banter, addHint, status, variety,
    get followUps() { return followUps; },
    get phase() { return phase; },
    /** True for 30 s after Quark last spoke: you are in a conversation, so hands-free needs no "Hey Quark". */
    get conversing() { return Date.now() - lastReplyAt < 30000; },
    resetFollowUps() { followUps = 0; },
    cancel() { token++; queued.length = 0; interrupt(); face.release('chat'); },
  };
}
