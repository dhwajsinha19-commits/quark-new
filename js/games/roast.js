// Roast Battle: three rounds. Rounds 1 and 3 Quark roasts you first and you fire back; in round 2 you go first and Quark
// answers what you said. A blind AI judge (it doesn't know who wrote which) scores each roast on wit, specificity,
// originality and delivery. Quark can lose, and says so when your roast was good. The heat meter climbs with every good
// exchange. It ends warm either way.
//
// Levels: Chill, Spicy and Savage. Savage is adults only and has to be switched on; in Kid mode it is always Chill.
// At every level these stay off-limits: looks, family, religion, gender, health, money, grief. Roasts that touch them
// are never scored (the AI is told, the backend filters, and so does this file).
//
// You answer by voice (the microphone stays open until you pause for a moment or say "done") or by typing.
// With no AI backend, Quark falls back to stock lines in roastlib.js and a simple local judge.

import { load, save, settings } from '../storage.js';
import { memory } from '../memory.js';
import { roastRequest, judgeBlind } from '../brain.js';
import { clamp } from '../util.js';
import { gameShell, el, wait } from './shell.js';
import { openerLine, comebackLine, finaleLine, STARTERS, isOffLimits, OFF_LIMITS_LINES, localJudge, FINAL_COMPLIMENTS, CONCEDE, BRAG, TIE, pick } from './roastlib.js';

const ROUNDS = 3;
const ANSWER_MS = 45000;
const CRIT = [['wit', 'Wit'], ['specificity', 'Specific'], ['originality', 'Original'], ['delivery', 'Delivery']];
const LEVEL_NOTE = {
  chill: 'Gentle, silly teasing. Giggles guaranteed.',
  spicy: 'Cheeky with real bite. Expect an “ouch”.',
  savage: 'Sharp and ruthless about harmless things.',
};
const flame = '<svg viewBox="0 0 48 48" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M24 4c1 7-5 9-5 16 0 3 2 5 4 6-1-4 1-7 4-9 1 5 6 8 6 14a9 9 0 0 1-18 0c0-4 2-6 3-9C13 24 11 28 11 32a13 13 0 0 0 26 0c0-9-10-12-13-28z"/></svg>';

const avg = (o) => Math.round((o.wit + o.specificity + o.originality + o.delivery) / 4);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mount(q, layer, ctx) {
  const shell = gameShell(layer, { title: 'Roast Battle', onBack: ctx.exit });
  const kid = q.profile.kid;
  q.face.express('playful', { key: 'game' });
  let dead = false;
  let qTotal = 0, uTotal = 0;
  let heat = 25;
  let answerResolve = null;
  let ui = null;
  let lastEmotion = 'excited';
  const battle = [];                           // everything said so far: { who: 'quark' | 'user', text }
  let level = kid ? 'chill' : settings.get('roastLevel') || 'spicy';
  if (level === 'savage' && !(settings.get('roastSavageOk') && !kid)) level = 'spicy';

  const say = (t, o = {}) => (dead ? Promise.resolve(false) : q.say(t, { emotion: o.emotion || 'excited', natural: true, ...o }));

  // ------------------------------------------------------------------ intro
  function showIntro() {
    qTotal = uTotal = 0;
    heat = 25;
    battle.length = 0;
    shell.setScore('');
    shell.body.innerHTML = '';
    const card = el('div', 'g-card', `
      <h3>Roast Battle</h3>
      <p>Three rounds. I roast you, you roast me back, and a blind judge scores both on wit, specificity, originality and delivery. Talk (pause or say “done” when you finish) or type.</p>
      <div class="seg roast-levels" role="group" aria-label="Heat level">
        <button type="button" data-l="chill">Chill</button>
        <button type="button" data-l="spicy" ${kid ? 'disabled' : ''}>Spicy</button>
        <button type="button" data-l="savage" ${kid || !settings.get('roastSavageOk') ? 'disabled' : ''}>Savage</button>
      </div>
      <p class="g-note" data-note></p>
      ${kid ? '' : `<label class="savage-ok"><input type="checkbox" data-savage ${settings.get('roastSavageOk') ? 'checked' : ''}> I'm 18 or older and I want Savage</label>`}
      <p class="g-note">Off-limits at every level: looks, family, religion, health, money.</p>
      <div class="g-row"><button class="g-btn primary" type="button" data-go>Bring it on</button></div>`);
    shell.body.appendChild(card);
    const paint = () => {
      card.querySelectorAll('[data-l]').forEach((b) => b.classList.toggle('on', b.dataset.l === level));
      card.querySelector('[data-note]').textContent = LEVEL_NOTE[level];
    };
    paint();
    card.querySelectorAll('[data-l]').forEach((b) => b.addEventListener('click', () => { if (b.disabled) return; level = b.dataset.l; settings.set('roastLevel', level); paint(); }));
    const sv = card.querySelector('[data-savage]');
    if (sv) sv.addEventListener('change', () => {
      settings.set('roastSavageOk', sv.checked);
      card.querySelector('[data-l="savage"]').disabled = !sv.checked;
      if (!sv.checked && level === 'savage') { level = 'spicy'; settings.set('roastLevel', level); paint(); }
    });
    card.querySelector('[data-go]').addEventListener('click', () => { q.audio.unlock(); q.voice.unlock(); startMatch(); });
    q.idle.poke();
    say('Roast battle. Pick your heat.', { emotion: 'excited' });
  }

  function buildArena() {
    shell.body.innerHTML = '';
    const a = el('div', 'roast-arena', `
      <div class="roast-top">
        <div class="roast-round"></div>
        <div class="heat" aria-label="Heat"><span class="heat-ico">${flame}</span><span class="heat-bar"><i></i></span><b class="heat-n">25</b></div>
      </div>
      <div class="roast-bubble" hidden></div>
      <div class="roast-think" hidden><span class="dots"><i></i><i></i><i></i></span> <span class="think-text"></span></div>
      <div class="roast-ask" hidden>
        <div class="roast-prompt"></div>
        <div class="roast-live"><span class="mic-dot"></span><span class="live-text"></span></div>
        <form class="roast-input" autocomplete="off">
          <input type="text" maxlength="260" placeholder="…or type your roast" enterkeyhint="send">
          <button class="send-btn" type="submit" aria-label="Send roast"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
        </form>
        <div class="g-row"><button type="button" class="g-btn" data-done>Done</button></div>
        <div class="roast-chips">${STARTERS.map((s) => `<button type="button" class="chip">${s}</button>`).join('')}</div>
      </div>
      <div class="roast-result" hidden></div>`);
    shell.body.appendChild(a);
    const form = a.querySelector('.roast-input');
    const input = form.querySelector('input');
    const u = {
      a, round: a.querySelector('.roast-round'), bubble: a.querySelector('.roast-bubble'), think: a.querySelector('.roast-think'), thinkText: a.querySelector('.think-text'),
      ask: a.querySelector('.roast-ask'), prompt: a.querySelector('.roast-prompt'), live: a.querySelector('.live-text'), dot: a.querySelector('.mic-dot'),
      input, result: a.querySelector('.roast-result'), heatBar: a.querySelector('.heat-bar i'), heatN: a.querySelector('.heat-n'), heat: a.querySelector('.heat'),
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(input.value); });
    a.querySelector('[data-done]').addEventListener('click', () => submit(u.live.textContent || input.value));
    a.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => { input.value = c.textContent.replace('…', ' '); input.focus(); }));
    return u;
  }

  function paintHeat(spark) {
    ui.heatBar.style.width = `${heat}%`;
    ui.heatN.textContent = String(Math.round(heat));
    ui.heat.dataset.level = heat >= 70 ? 'hot' : heat >= 40 ? 'warm' : 'cool';
    if (spark) { q.audio.chirp('excited'); for (let i = 0; i < 3; i++) setTimeout(() => q.face.burst('spark'), i * 110); }
  }
  function bumpHeat(by) {
    const before = heat;
    heat = clamp(heat + by, 0, 100);
    paintHeat(heat - before >= 12);
    if (heat >= 80 && before < 80) q.face.express('insane', { ms: 700, key: 'game' });
  }

  // ------------------------------------------------------------------ asking the user
  function submit(text) {
    const t = String(text || '').trim();
    if (!answerResolve || !t) return false;
    answerResolve(t);
    return true;
  }

  /** Listen for the user's roast: the microphone stays open until a pause of a couple of seconds or "done"; typing also works. */
  function askUser(promptText) {
    return new Promise((resolve) => {
      if (dead) return resolve('');
      ui.prompt.textContent = promptText;
      ui.input.value = '';
      ui.live.textContent = '';
      ui.ask.hidden = false;
      q.face.express('listen', { key: 'game' });
      let settled = false;
      const timer = setTimeout(() => done(ui.live.textContent), ANSWER_MS);
      function done(text) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        answerResolve = null;
        ui.ask.hidden = true;
        ui.dot.classList.remove('on');
        q.listen?.stop?.();
        resolve(String(text || '').trim());
      }
      answerResolve = done;
      if (q.listen && q.listen.supported && !q.listen.denied) {
        ui.dot.classList.add('on');
        ui.live.textContent = 'Listening… pause or say “done” when you finish';
        q.listen.captureLong({ pauseMs: 2500, maxMs: ANSWER_MS - 3000, onInterim: (t) => { ui.live.textContent = t; } }).then((t) => done(t || (ui.live.textContent.startsWith('Listening') ? '' : ui.live.textContent)));
      } else {
        setTimeout(() => ui.input.focus(), 50);
      }
    });
  }

  /** Ask for a roast; if it's off-limits, say so once and ask again. Returns { text, flagged }. */
  async function getUserRoast(promptText) {
    let text = await askUser(promptText);
    if (dead) return { text: '', flagged: false };
    if (text && isOffLimits(text)) {
      q.face.express('startled', { ms: 1200, key: 'game' });
      await say(OFF_LIMITS_LINES(), { emotion: 'startled' });
      if (dead) return { text: '', flagged: false };
      text = await askUser('Go again, and keep it harmless.');
      if (text && isOffLimits(text)) return { text, flagged: true };
    }
    if (text) battle.push({ who: 'user', text });
    return { text, flagged: false };
  }

  // ------------------------------------------------------------------ Quark's roasts
  async function thinking(label, promise) {
    ui.think.hidden = false;
    ui.thinkText.textContent = label;
    q.face.express('curious', { key: 'game' });
    try { return await promise; } finally { if (ui) ui.think.hidden = true; }
  }

  async function quarkRoast(role, n, userRoast = '') {
    const fallback = role === 'reply' ? comebackLine : n === ROUNDS ? finaleLine : openerLine;
    const body = { level, kid, round: n, rounds: ROUNDS, role, userRoast, userName: memory.userName, facts: kid ? [] : memory.facts, battle: battle.slice(-8) };
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await thinking(role === 'reply' ? 'Loading a comeback…' : 'Cooking something up…', roastRequest(body));
      if (dead) return '';
      if (!r) break;                                           // no brain: use a stock line
      if (r.roast && !isOffLimits(r.roast)) { lastEmotion = r.emotion || 'excited'; return r.roast; }
    }
    return fallback();
  }

  async function deliver(text) {
    battle.push({ who: 'quark', text });
    ui.bubble.hidden = false;
    ui.bubble.textContent = text;
    q.face.express('playful', { ms: 7000, key: 'game' });
    await say(text, { emotion: lastEmotion, maxWords: 9 });
  }

  // ------------------------------------------------------------------ rounds
  async function startMatch() {
    ui = buildArena();
    paintHeat(false);
    for (let n = 1; n <= ROUNDS; n++) {
      if (dead) return;
      await playRound(n);
    }
    if (!dead) await finish();
  }

  async function judge(n, qRoast, user) {
    if (!user.text) return { quark: { wit: 5, specificity: 5, originality: 5, delivery: 5, reason: 'Won the round by waiting.' }, user: { wit: 0, specificity: 0, originality: 0, delivery: 0, reason: 'Silence is a roast too, but it scores zero.' }, quip: 'You went quiet on me.' };
    if (user.flagged) return { quark: { wit: 5, specificity: 5, originality: 5, delivery: 5, reason: 'Clean and harmless.' }, user: { wit: 0, specificity: 0, originality: 0, delivery: 0, reason: 'That touched an off-limits topic, so no points.', flagged: true }, quip: 'Keep it harmless next round.' };
    // blind: the judge sees roast A and roast B and never learns which one is Quark's
    const quarkIsA = Math.random() < 0.5;
    const roasts = quarkIsA ? { a: qRoast, b: user.text } : { a: user.text, b: qRoast };
    const res = await thinking('The judge is deciding…', judgeBlind({ round: n, roasts, level, kid }));
    if (dead) return null;
    if (!res) return localJudge(qRoast, user.text);
    return { quark: quarkIsA ? res.a : res.b, user: quarkIsA ? res.b : res.a, quip: res.quip };
  }

  async function playRound(n) {
    ui.result.hidden = true;
    ui.bubble.hidden = true;
    ui.round.textContent = `Round ${n} of ${ROUNDS} · You ${uTotal} – ${qTotal} ${q.name()}`;
    shell.setScore(`${uTotal} – ${qTotal}`);
    q.face.express('playful', { key: 'game' });
    q.audio.thump(0.9);
    let qRoast = '';
    let user = { text: '', flagged: false };

    if (n % 2 === 1) {
      await say(n === 1 ? 'Round one. I go first.' : n === ROUNDS ? 'Final round. My turn first.' : 'My turn.', { emotion: 'excited' });
      if (dead) return;
      qRoast = await quarkRoast('open', n);
      if (dead) return;
      await deliver(qRoast);
      if (dead) return;
      user = await getUserRoast('Your turn. Roast me back.');
    } else {
      await say('Round two. You go first. Roast me.', { emotion: 'excited' });
      if (dead) return;
      user = await getUserRoast('You go first. Roast me.');
      if (dead) return;
      if (user.text && !user.flagged) {
        q.face.express('startled', { ms: 1200, key: 'game' });
        q.audio.startle();
        qRoast = await quarkRoast('reply', n, user.text);
        if (dead) return;
        await deliver(qRoast);
      }
    }
    if (dead) return;

    const v = await judge(n, qRoast, user);
    if (dead || !v) return;
    v.quark.total = avg(v.quark);
    v.user.total = avg(v.user);
    // the judge is told the rules and the backend enforces them, but nothing off-limits ever scores, whatever came back
    if (user.text && isOffLimits(user.text)) { v.user = { wit: 0, specificity: 0, originality: 0, delivery: 0, total: 0, reason: 'That touched an off-limits topic, so no points.', flagged: true }; }
    qTotal += v.quark.total;
    uTotal += v.user.total;
    showResult(v);
    shell.setScore(`${uTotal} – ${qTotal}`);
    bumpHeat(((v.quark.total + v.user.total) / 2 - 4) * 9);

    const userWon = v.user.total > v.quark.total;
    const headline = userWon ? CONCEDE() : v.user.total < v.quark.total ? BRAG() : TIE();
    q.face.express(userWon ? 'startled' : 'joy', { ms: 2500, key: 'game' });
    await say(headline, { emotion: userWon ? 'startled' : 'happy' });
    if (dead) return;
    if (v.user.reason && user.text) await say(`Your roast: ${v.user.reason}`, { emotion: 'content', maxWords: 9 });
    if (dead) return;
    if (v.quip) await say(v.quip, { emotion: 'happy' });
    await wait(500);
  }

  function showResult(v) {
    const row = (who, cls, r) => `
      <div class="rr-block ${cls}">
        <div class="rr-row ${cls}"><span class="rr-who">${esc(who)}</span><span class="rr-bar"><i style="width:${r.total * 10}%"></i></span><b>${r.total}/10</b></div>
        <div class="rr-crit">${CRIT.map(([k, label]) => `<span><em>${label}</em><i style="--w:${(r[k] || 0) * 10}%"></i></span>`).join('')}</div>
        <div class="rr-why">${esc(r.reason || '')}</div>
      </div>`;
    ui.result.hidden = false;
    ui.result.innerHTML = row(q.name(), '', v.quark) + row('You', 'you', v.user);
  }

  async function finish() {
    const userWon = uTotal > qTotal, tie = uTotal === qTotal;
    const rec = load('roastStats', { w: 0, l: 0 });
    if (userWon) rec.w++; else if (!tie) rec.l++;
    save('roastStats', rec);
    ui.ask.hidden = true;
    ui.bubble.hidden = true;
    ui.result.hidden = false;
    ui.result.innerHTML = `<div class="rr-final ${userWon ? 'you' : tie ? '' : 'quark'}">${tie ? `Dead heat! ${uTotal} – ${qTotal}` : userWon ? `You win ${uTotal} – ${qTotal}!` : `${esc(q.name())} wins ${qTotal} – ${uTotal}!`}</div>`;
    shell.setScore(`${uTotal} – ${qTotal}`);
    await say(tie ? `It's a tie, ${uTotal} to ${qTotal}.` : `Final score: you ${uTotal}, me ${qTotal}.`, { emotion: 'excited' });
    if (dead) return;

    // no sulking, win or lose: a short tantrum or a dance, then everything is warm again
    if (userWon) await q.endings.loseTantrum({ short: true, praise: false });
    else if (tie) { q.face.express('joy', { ms: 2500, key: 'game' }); for (let i = 0; i < 4; i++) setTimeout(() => q.face.burst('heart'), i * 130); await wait(1200); }
    else await q.endings.winDance({ line: 'Good roasting, though. I almost felt one.' });
    if (dead) return;

    // always end warm; the AI writes it when there is one
    q.face.express('happy', { ms: 5000, key: 'game' });
    for (let i = 0; i < 3; i++) setTimeout(() => q.face.burst('heart'), i * 150);
    const ev = `The roast battle is over (${tie ? 'a tie' : userWon ? 'the user won' : 'you won'}, ${uTotal} to ${qTotal}). Say one short, genuinely warm thing to the user about how they did or how much fun that was. No roast.`;
    const warm = await Promise.race([q.chat.banter(ev, () => '', 'happy'), wait(9000).then(() => null)]);
    await say((warm && warm.reply) || pick(FINAL_COMPLIMENTS)(memory.userName), { emotion: 'happy' });
    if (dead) return;
    const card = el('div', 'g-card', `
      <h3>${tie ? 'It was a tie!' : userWon ? 'You won!' : `${esc(q.name())} won!`}</h3>
      <p>Thanks for the roast battle. Rematch?</p>
      <div class="g-row"><button class="g-btn primary" type="button" data-again>Rematch</button><button class="g-btn" type="button" data-home>Home</button></div>`);
    shell.body.appendChild(card);
    card.querySelector('[data-again]').addEventListener('click', () => showIntro());
    card.querySelector('[data-home]').addEventListener('click', ctx.exit);
  }

  showIntro();
  return {
    id: 'roast',
    title: 'roast battle',
    handleText(text) { return submit(text); },
    destroy() { dead = true; if (answerResolve) answerResolve(''); q.listen?.stop?.(); },
  };
}
