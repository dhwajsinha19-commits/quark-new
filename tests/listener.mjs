// The microphone state machine, driven by a fake SpeechRecognition. Run: node tests/listener.mjs
const instances = [];
class FakeSR {
  constructor() { this.started = false; this.aborted = false; instances.push(this); }
  start() { if (this.started && !this.aborted) throw new Error('InvalidStateError'); this.started = true; this.aborted = false; setTimeout(() => this.onstart?.(), 0); }
  stop() { setTimeout(() => this.end(), 0); }
  abort() { this.aborted = true; }
  say(items) { // items: [{ t, final, conf, alts }]
    const results = items.map((it) => { const r = [{ transcript: it.t, confidence: it.conf ?? 0.9 }, ...(it.alts || []).map((a) => ({ transcript: a, confidence: 0.3 }))]; r.isFinal = !!it.final; return r; });
    this.onresult?.({ resultIndex: 0, results });
  }
  fail(error) { this.onerror?.({ error }); this.end(); }
  end() { this.started = false; this.onend?.(); }
}
globalThis.window = globalThis; globalThis.SpeechRecognition = FakeSR;
globalThis.document = { hidden: false }; Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-IN' }, configurable: true });
const { createListener, pickTranscript } = await import('../js/listen.js');
const { mic } = await import('../js/debuglog.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : (fail++, console.log('FAIL', n, x)); };
const last = () => instances[instances.length - 1];

let speaking = false, conversing = false, numbersGame = false, accent = ''; const log = [];
const L = createListener({ getName: () => 'Quark', isSpeaking: () => speaking, isConversing: () => conversing, wantsNumbers: () => numbersGame, getLang: () => accent,
  onFinal: (t, h) => log.push(['final', t, h]), onWake: (t, h) => log.push(['wake', t, h]), onNotice: (m) => log.push(['notice', m]), onNoSpeech: () => log.push(['nospeech']), onState: (s) => log.push(['state', s]) });

// 1. tap the mic and speak
L.listenOnce(); await sleep(20);
ok(L.state === 'listening', 'listening after tap', L.state);
ok(L.debug().recState === 'listening', 'debug state: listening', L.debug().recState);
last().say([{ t: 'how was your day', final: true, conf: 0.93, alts: ['how was the day'] }]); await sleep(30);
const fin = log.find((e) => e[0] === 'final');
ok(fin && fin[1] === 'how was your day' && fin[2].confidence === 0.93 && fin[2].alternatives[0] === 'how was the day', 'one-shot delivers text + confidence + alternatives', JSON.stringify(fin));
ok(L.state === 'idle', 'back to idle', L.state);
ok(mic.final === 'how was your day' && mic.events.some((e) => e.type === 'final'), 'debug recorder saw the transcript and the event');

// 2. silence: no words, a gentle no-speech signal
log.length = 0; L.listenOnce(); await sleep(20); last().fail('no-speech'); await sleep(20);
ok(log.some((e) => e[0] === 'nospeech'), 'no-speech reported without any canned message');
ok(!log.some((e) => e[0] === 'notice'), 'no notice text for silence');
ok(mic.events.some((e) => e.type === 'error' && e.detail === 'no-speech' && e.level === 'warn'), 'no-speech is recorded as a warning');

// 3. network errors back off but never disable listening for good
log.length = 0;
L.listenOnce(); await sleep(20); last().fail('network'); await sleep(10);
ok(log.some((e) => e[0] === 'notice' && /speech service/.test(e[1])), 'a network error on a tap is explained at once');
ok(!log.some((e) => e[0] === 'nospeech'), 'and is not mistaken for silence');
ok(L.supported === true, 'still supported after network errors');
const before = instances.length; L.listenOnce(); await sleep(30);
ok(instances.length > before && L.state === 'listening', 'a new tap listens again', `${instances.length - before} ${L.state}`);
last().say([{ t: 'hello there', final: true }]); await sleep(30);
ok(log.some((e) => e[0] === 'final' && e[1] === 'hello there'), 'works again after the network came back');

// 4. hands-free: wake phrase needed, except during a conversation
log.length = 0; L.setHandsFree(true); await sleep(40);
ok(L.state === 'hands-free', 'hands-free listening', L.state);
last().say([{ t: 'how was your day', final: true }]); await sleep(20);
ok(!log.some((e) => e[0] === 'wake'), 'ambient speech without the wake phrase is ignored');
last().say([{ t: "hey quark what's up", final: true }]); await sleep(20);
ok(log.some((e) => e[0] === 'wake' && e[1] === "what's up"), 'wake phrase works');
L.kick(); await sleep(700);
conversing = true; log.length = 0;
last().say([{ t: 'how was your day', final: true, conf: 0.8 }]); await sleep(20);
const w2 = log.find((e) => e[0] === 'wake');
ok(w2 && w2[1] === 'how was your day' && w2[2].confidence === 0.8, 'inside a conversation no wake phrase is needed', JSON.stringify(w2));
conversing = false; L.setHandsFree(false);

// 5. Quark talking turns the mic off and it comes back
log.length = 0; L.listenOnce(); await sleep(20);
speaking = true; L.speechStarted(); await sleep(10);
ok(L.state !== 'listening', 'mic off while Quark talks', L.state);
ok(L.debug().recState === 'speaking-paused', 'debug state: speaking-paused', L.debug().recState);
speaking = false; L.speechEnded(); await sleep(700);
ok(L.state === 'listening', 'mic comes back after Quark stops', L.state);
last().say([{ t: 'ok next question', final: true }]); await sleep(20);

// 6. captureLong: waits for a pause, or "done"
let interim = []; const t0 = Date.now();
const p1 = L.captureLong({ pauseMs: 120, maxMs: 3000, onInterim: (t) => interim.push(t) }); await sleep(20);
last().say([{ t: 'you type like', final: false }]); await sleep(40);
last().say([{ t: 'you type like a pigeon', final: true }, { t: 'doing taxes', final: false }]);
const r1 = await p1;
ok(r1 === 'you type like a pigeon doing taxes' && Date.now() - t0 >= 130, 'long capture ends on a pause with the full text', `${r1} ${Date.now() - t0}ms`);
ok(interim.length >= 2 && interim[0] === 'you type like', 'live text while talking', JSON.stringify(interim));
const p2 = L.captureLong({ pauseMs: 5000, maxMs: 6000 }); await sleep(20);
const t1 = Date.now(); last().say([{ t: "your wifi is slower than my grandma's dial up, done", final: true }]);
const r2 = await p2;
ok(r2 === "your wifi is slower than my grandma's dial up" && Date.now() - t1 < 200, '"done" ends it at once and is not part of the text', `${JSON.stringify(r2)} ${Date.now() - t1}ms`);
const p3 = L.captureLong({ pauseMs: 100, maxMs: 300 }); const t2 = Date.now();
const r3 = await p3; ok(r3 === '' && Date.now() - t2 < 600, 'silence ends with an empty answer', `${JSON.stringify(r3)} ${Date.now() - t2}ms`);
const p4 = L.captureLong({ pauseMs: 5000, maxMs: 6000 }); await sleep(20); last().say([{ t: 'half a roast', final: false }]); await sleep(10); L.stop();
ok((await p4) === 'half a roast', 'stop() resolves a pending capture with what was heard');
const p5 = L.captureLong({ pauseMs: 100, maxMs: 1500 }); await sleep(20); const sr = last(); sr.end(); await sleep(20);
ok(sr.started, 'restarts after a silent session end');
sr.say([{ t: 'late roast', final: true }]); ok((await p5) === 'late roast', 'still captures after Chrome restarted it');

// 7. a failed start() is not a dead end
const orig = FakeSR.prototype.start; let thrown = 0; FakeSR.prototype.start = function () { if (!thrown++) throw new Error('InvalidStateError'); return orig.call(this); };
log.length = 0; L.listenOnce(); await sleep(700);
ok(L.state === 'listening', 'recovers when start() throws once', L.state);
ok(mic.events.some((e) => e.type === 'start failed' && e.level === 'error'), 'the refused start is recorded as an error');
FakeSR.prototype.start = orig; L.stop();

// 8. words the recogniser writes as numbers ("fought" -> "14")
const R = (alts) => alts.map((t) => ({ transcript: t, confidence: 0.8 }));
const P = (alts, o) => pickTranscript(R(alts), o);
ok(P(['14', 'fought']).text === 'fought' && P(['14', 'fought']).swapped, 'a lone "14" with the word "fought" offered becomes "fought"');
ok(P([' 14', 'fought']).text === ' fought', 'the leading space of a continuation result is kept');
ok(P(['14', 'fourteen', 'fort']).text === 'fort', 'the spelled number "fourteen" is skipped, the next word reading wins');
ok(P(['14', 'fourteen']).text === '14' && !P(['14', 'fourteen']).swapped, '"fourteen" alone is the same number, so the digits stay');
ok(P(['2', 'to']).text === '2' && P(['4', 'for', 'four']).text === '4' && P(['8', 'ate']).text === '8', 'number sound-alikes (to, for, ate) are not swapped: they are as likely to be numbers');
ok(P(['i am 14 years old', 'i am fourteen years old']).text === 'i am 14 years old', 'a real number inside a long sentence is left alone');
ok(P(['how was your day', 'how was the day']).text === 'how was your day', 'a phrase with no digits is never touched');
ok(P(['14', 'fought'], { numbersOk: true }).text === '14', 'while chess runs, digits are left alone');
ok(P(['14']).numeric === true && P(['14', '15']).numeric === true, 'a bare number with no word reading is flagged numeric');
ok(P(['14 apples']).numeric === false && P(['i have 2', 'i have to']).text === 'i have 2', 'a number with words around it is neither flagged nor rewritten');
ok(P(['14', 'fought']).numeric === false, 'a swapped phrase is not flagged');

log.length = 0; L.listenOnce(); await sleep(20);
last().say([{ t: '14', final: true, conf: 0.7, alts: ['fought', 'fort'] }]); await sleep(30);
let f8 = log.find((e) => e[0] === 'final');
ok(f8 && f8[1] === 'fought' && f8[2].alternatives.includes('14') && f8[2].alternatives.includes('fort') && f8[2].numeric === false, 'one-shot: "14" is delivered as "fought", the digits kept as an alternative', JSON.stringify(f8));
ok(mic.events.some((e) => e.type === 'number-fix'), 'the swap is recorded in the debug log');

log.length = 0; L.listenOnce(); await sleep(20);
last().say([{ t: '14', final: true, conf: 0.7 }]); await sleep(30);
f8 = log.find((e) => e[0] === 'final');
ok(f8 && f8[1] === '14' && f8[2].numeric === true, 'one-shot: a bare number with no other reading is passed on, flagged for the brain', JSON.stringify(f8));

numbersGame = true; log.length = 0; L.listenOnce(); await sleep(20);
last().say([{ t: '14', final: true, conf: 0.7, alts: ['fought'] }]); await sleep(30);
f8 = log.find((e) => e[0] === 'final');
ok(f8 && f8[1] === '14' && f8[2].numeric === false, 'in a number game the digits are kept and not flagged', JSON.stringify(f8));
numbersGame = false;

log.length = 0; L.setHandsFree(true); await sleep(40); conversing = true;
last().say([{ t: 'forty', final: true }]); await sleep(10); log.length = 0;
last().say([{ t: '14 yes', final: true, conf: 0.9, alts: ['fought yes'] }]); await sleep(20);
const w8 = log.find((e) => e[0] === 'wake');
ok(w8 && w8[1] === '14 yes', 'a two-word phrase with a number in it is not rewritten', JSON.stringify(w8));
conversing = false; L.setHandsFree(false); L.stop();


// 9. the on-device / own-key brain gets the same note
const { contextBlock } = await import('../js/ondevice.js');
const cb = contextBlock({ message: '14', heard: { confidence: 0.7, alternatives: ['fought', 'fort', 'fourth', 'fifth'], numeric: true }, context: {} });
ok(/only a number/.test(cb) && /fought/.test(cb) && /fourth/.test(cb) && !/fifth/.test(cb), 'contextBlock flags a bare number and forwards three alternatives', cb);
ok(!/only a number/.test(contextBlock({ message: '14', heard: { confidence: 0.9, alternatives: [] }, context: {} })), 'contextBlock adds no note when the phrase is not flagged');

// 10. the accent picked in Settings is what the recogniser is asked for
L.listenOnce(); await sleep(20); ok(last().lang === 'en-IN', 'no pick: the browser English is used', last().lang); L.stop();
accent = 'en-GB'; L.listenOnce(); await sleep(20); ok(last().lang === 'en-GB', 'a picked accent wins over the browser language', last().lang); L.stop();
accent = 'not a language!'; L.listenOnce(); await sleep(20); ok(last().lang === 'en-IN', 'a junk value is ignored', last().lang); L.stop();
accent = '';
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
