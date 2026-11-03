// The Home grid and the Settings page.

import { CONFIG } from './config.js';
import { settings, load } from './storage.js';
import { memory } from './memory.js';
import { brainKind, discoverBrain, getConfiguredUrl } from './brain.js';
import { ownKey, testKey, usageReport, onUsageChange, whenText } from './geminikey.js';
import { createHand } from './handsvg.js';
import { pieceSvg } from './games/pieces.js';
import * as onDevice from './ondevice.js';
import { hasPin } from './pin.js';

const ICONS = {
  tap: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="24" cy="24" r="6" fill="currentColor" stroke="none"/><circle cx="24" cy="24" r="13" opacity=".6"/><circle cx="24" cy="24" r="20" opacity=".3"/></svg>',
  roast: '<svg viewBox="0 0 48 48" fill="currentColor"><path d="M24 4c1 7-5 9-5 16 0 3 2 5 4 6-1-4 1-7 4-9 1 5 6 8 6 14a9 9 0 0 1-18 0c0-4 2-6 3-9C13 24 11 28 11 32a13 13 0 0 0 26 0c0-9-10-12-13-28z"/></svg>',
};

const CARDS = [
  { id: 'tap', title: 'Tap Challenge', desc: '10 seconds. Tap like mad.', accent: '#ffcf5a', icon: () => ICONS.tap, stat: () => { const b = load('tapBest', 0); return b ? `Best: ${b} taps` : 'Set your first score'; } },
  { id: 'rps', title: 'Rock Paper Scissors', desc: 'Best of 3 or 5. Quark shakes a hand at you.', accent: '#7affc8', icon: 'hand', stat: () => { const s = load('rpsStats', null); return s ? `${s.w} wins · ${s.l} losses` : 'Say it: “let’s play”'; } },
  { id: 'chess', title: 'Chess', desc: 'Voice, type or tap your moves.', accent: '#b78bff', icon: 'knight', stat: () => { const s = load('chessStats', null); return s ? `${s.w} wins · ${s.l} losses · ${s.d} draws` : 'Casual and beatable'; } },
  { id: 'roast', title: 'Roast Battle', desc: 'Three friendly rounds. No mercy. Lots of love.', accent: '#ff8a5c', icon: () => ICONS.roast, stat: () => { const s = load('roastStats', null); return s ? `${s.w} wins · ${s.l} losses` : 'Bring your best burn'; } },
];

function greetingWord() {
  const h = new Date().getHours();
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
}

const gearIcon = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 14.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
const gkEyeIcon = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const backIcon = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';

export function mountHome(q, { home, settingsEl }) {
  // ------------------------------------------------------------------ Home
  function renderHome() {
    const user = memory.userName;
    home.innerHTML = `
      <header class="home-top">
        <div>
          <div class="home-hello">${greetingWord()}${user ? `, ${escapeHtml(user)}` : ''}</div>
          <div class="home-sub">What are we doing today?</div>
        </div>
        <button class="home-gear" type="button" aria-label="Settings">${gearIcon}</button>
      </header>

      <button class="hero" type="button" data-go="quark" aria-label="Hang out with ${escapeHtml(q.name())}">
        <div class="hero-face" aria-hidden="true"><i></i><i></i><b></b></div>
        <div class="hero-text">
          <div class="hero-name">${escapeHtml(q.name())}</div>
          <div class="hero-line">Tap to hang out, pet, and chat</div>
        </div>
        <span class="hero-go">›</span>
      </button>

      <h2 class="home-h">Play with ${escapeHtml(q.name())}</h2>
      <div class="cards">
        ${CARDS.map((c) => `
          <button class="card" type="button" data-game="${c.id}" style="--accent:${c.accent}">
            <span class="card-icon" data-icon="${c.id}"></span>
            <span class="card-title">${c.title}</span>
            <span class="card-desc">${c.desc}</span>
            <span class="card-stat">${c.stat()}</span>
          </button>`).join('')}
      </div>

      <p class="home-foot">The camera and microphone stay off until you turn them on. Video never leaves your phone.</p>
    `;
    // icons that are built from code
    home.querySelectorAll('[data-icon]').forEach((el) => {
      const c = CARDS.find((x) => x.id === el.dataset.icon);
      if (c.icon === 'hand') { const h = createHand('scissors'); el.appendChild(h.el); }
      else if (c.icon === 'knight') el.innerHTML = pieceSvg('n', 'w');
      else el.innerHTML = c.icon();
    });
    home.querySelector('.home-gear').addEventListener('click', () => q.router.go('settings'));
    home.querySelector('.hero').addEventListener('click', () => { q.audio.unlock(); q.voice.unlock(); q.router.go('quark'); });
    home.querySelectorAll('[data-game]').forEach((b) => b.addEventListener('click', () => { q.audio.unlock(); q.voice.unlock(); q.router.go('game', { id: b.dataset.game }); }));
  }

  // ------------------------------------------------------------------ Settings
  const toggle = (id, label, hint, on) => `
    <label class="row-set" for="${id}">
      <span class="row-text"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span>
      <input class="switch" type="checkbox" id="${id}" ${on ? 'checked' : ''}>
    </label>`;

  let pendingToast = '';             // shown once after the page is rebuilt (e.g. after switching mode)

  let gkUsageOff = null;      // stops the live usage numbers when the Settings screen is drawn again
  function renderSettings() {
    const url = getConfiguredUrl();
    const kind = brainKind();
    const brainLine = brainText(kind, url);
    const kid = q.profile.kid;
    const focus = q.profile.focus;
    settingsEl.innerHTML = `
      <header class="set-top">
        <button class="set-back" type="button" aria-label="Back">${backIcon}</button>
        <h1>Settings</h1>
      </header>

      <section class="set-card">
        <h3>Your robot</h3>
        <div class="set-name">
          <input id="setName" type="text" maxlength="16" value="${escapeHtml(q.name())}" placeholder="Quark" autocomplete="off" autocapitalize="words" spellcheck="false">
          <button class="btn primary" id="setNameSave" type="button">Rename</button>
        </div>
        <p class="set-note">Say “Hey <span id="wakePreview">${escapeHtml(q.name())}</span>” to wake it up. Everything it says uses this name.</p>
      </section>

      <section class="set-card">
        <h3>Who is Quark for?</h3>
        <div class="row-set" style="cursor:default">
          <span class="row-text"><b>Mode</b><small id="modeNote">${kid ? 'Kid friend and teacher: patient, simple, family-safe. Only the parent PIN switches this off.' : 'Adult companion: a witty, honest pet that chats about anything.'}</small></span>
          <div class="seg" id="setMode">
            <button type="button" data-m="adult" class="${kid ? '' : 'on'}">Adult</button>
            <button type="button" data-m="kid" class="${kid ? 'on' : ''}">Kid</button>
          </div>
        </div>
        <div id="focusRow" ${kid ? 'hidden' : ''}>
          ${toggle('setFocus', 'Focus buddy', 'Quiet company while you work: it rarely speaks, hums now and then, and never interrupts.', focus)}
        </div>
        <div class="row-set" style="cursor:default" id="pinRow">
          <span class="row-text"><b>Parent PIN</b><small>${hasPin() ? 'Set. It locks Kid mode and Settings while Kid mode is on.' : 'Not set yet. You will be asked to choose one when you turn Kid mode on.'}</small></span>
          <button class="btn" id="setPin" type="button" ${hasPin() ? '' : 'hidden'}>Change</button>
        </div>
        <p class="set-note">${kid ? 'In Kid mode Quark keeps only a first name and favourite things, never uses camera or room information in its chats, and talks family-safe.' : 'Kids under 18 should use Kid mode: simpler words, no rude jokes, minimal data.'}</p>
      </section>

      <section class="set-card">
        <h3>Sound &amp; voice</h3>
        ${toggle('setSound', 'Sound', 'Chirps, purrs and talking. Subtitles always stay on.', settings.get('sound'))}
        <div class="row-set" style="cursor:default">
          <span class="row-text"><b>Face</b><small>Calm: small flat eyes, no mouth, like a desk robot. Classic: the original big glowing eyes.</small></span>
          <div class="seg" id="setFace">
            <button type="button" data-f="calm" class="${settings.get('faceStyle') !== 'classic' ? 'on' : ''}">Calm</button>
            <button type="button" data-f="classic" class="${settings.get('faceStyle') === 'classic' ? 'on' : ''}">Classic</button>
          </div>
        </div>
        <div class="row-set" style="cursor:default">
          <span class="row-text"><b>Listening accent</b><small>Which English the microphone listens for. Pick yours if it mishears you; "Browser" uses your browser's language.</small></span>
          <select class="sel" id="setSpeechLang" aria-label="Listening accent">
            ${[['', 'Browser'], ['en-IN', 'English (India)'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-AU', 'English (Australia)'], ['en-CA', 'English (Canada)'], ['en-ZA', 'English (South Africa)'], ['en-NG', 'English (Nigeria)'], ['en-SG', 'English (Singapore)']].map(([v, l]) => `<option value="${v}" ${settings.get('speechLang') === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="row-set" style="cursor:default">
          <span class="row-text"><b>How it talks</b><small id="voiceNote">${voiceNote()}</small></span>
          <div class="seg" id="setVoice">
            <button type="button" data-v="natural" class="${voiceKind() === 'natural' ? 'on' : ''}">Natural</button>
            <button type="button" data-v="speech" class="${voiceKind() === 'speech' ? 'on' : ''}">Robot</button>
            <button type="button" data-v="beeps" class="${voiceKind() === 'beeps' ? 'on' : ''}">Beeps</button>
          </div>
        </div>
        <div class="row-set" style="cursor:default">
          <span class="row-text"><b>Voice</b><small>Which Gemini voice Quark uses.</small></span>
          <select class="sel" id="setVoiceName" aria-label="Voice">
            ${[['Leda', 'youthful'], ['Puck', 'upbeat'], ['Zephyr', 'bright'], ['Aoede', 'breezy'], ['Fenrir', 'excitable'], ['Kore', 'firm'], ['Charon', 'informative'], ['Sulafat', 'warm']].map(([n, d]) => `<option value="${n}" ${settings.get('voiceName') === n ? 'selected' : ''}>${n} (${d})</option>`).join('')}
          </select>
        </div>
        <div class="row-set" style="cursor:default">
          <span class="row-text"><b>Speed &amp; pitch</b><small>Faster sounds smaller and cuter.</small></span>
          <input class="range" type="range" id="setVoiceRate" min="0.85" max="1.3" step="0.01" value="${settings.get('voiceRate')}" aria-label="Voice speed">
        </div>
        <div class="row-set" style="cursor:default">
          <span class="row-text"><b>Robot-ness</b><small>A tiny-speaker sound and a faint wobble.</small></span>
          <input class="range" type="range" id="setVoiceRobot" min="0" max="1" step="0.05" value="${settings.get('voiceRobot')}" aria-label="Robot amount">
        </div>
        <div class="row-set" style="cursor:default; align-items:flex-start">
          <span class="row-text"><b>Test the voice</b><small id="voiceTestNote">Pick a feeling and hear how Quark says it.</small></span>
          <div class="voice-test">
            <select class="sel" id="voiceTestEmotion" aria-label="Feeling">
              ${['happy', 'excited', 'curious', 'content', 'bored', 'sleepy', 'startled', 'scared', 'sulky', 'sad', 'angry'].map((e) => `<option value="${e}">${e}</option>`).join('')}
            </select>
            <button class="btn" id="voiceTestBtn" type="button">Play</button>
          </div>
        </div>
      </section>

      <section class="set-card">
        <h3>Voice Connection</h3>
        <div class="row-set" style="cursor:default">
          <span class="row-text"><b>Your custom voice (ElevenLabs)</b><small id="vcLine">${escapeHtml(vcLine())}</small></span>
          <button class="btn" id="vcOpen" type="button">Set up</button>
        </div>
      </section>

      <section class="set-card">
        <h3>Camera &amp; microphone</h3>
        ${toggle('setHands', 'Hands-free “Hey ' + escapeHtml(q.name()) + '”', 'Listens for the wake phrase only while a Quark or game page is open.', settings.get('handsFree'))}
        <div class="row-set">
          <span class="row-text"><b>Camera</b><small>${settings.get('cameraConsent') ? 'You have allowed Quark to see you. Turn it on from the eye button on the Quark page.' : 'Off. Quark asks before it ever looks.'}</small></span>
          <button class="btn" id="setCamForget" type="button" ${settings.get('cameraConsent') ? '' : 'disabled'}>Forget</button>
        </div>
        <p class="set-note">All video is processed on this device. No video, pictures or tracking data are ever uploaded or saved.</p>
      </section>

      <section class="set-card">
        <h3>Brain</h3>
        <p class="set-note" id="brainLine">${brainLine}</p>

        <label class="vc-lab" for="gkKey">Your own Gemini key (free)</label>
        <div class="vc-status" id="gkStatus" data-state="none" role="status" aria-live="polite"><i class="vc-dot"></i><span id="gkStatusText"></span></div>
        <div class="gk-usage" id="gkUsage" hidden></div>
        <div class="vc-field" style="margin-top:8px">
          <input class="vc-input" id="gkKey" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-1p-ignore data-lpignore="true"
                 placeholder="${ownKey.has() ? `Saved, ends in ${escapeHtml(ownKey.tail())}. Paste a new key to replace it` : 'Paste your Gemini key here'}">
          <button class="vc-eye" id="gkEye" type="button" aria-label="Show or hide the key" aria-pressed="false">${gkEyeIcon}</button>
        </div>
        <div class="vc-actions">
          <button class="btn primary" id="gkSave" type="button">Save &amp; test</button>
          <button class="btn" id="gkRemove" type="button">Remove key</button>
        </div>
        <p class="set-note">Get one free in about a minute, no card: open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" style="color:rgb(var(--eye))"><b>aistudio.google.com/apikey</b></a>, sign in with Google, press “Create API key”, then copy it and paste it here. Your key stays on this device and goes only to Google. Don't share this app with the key saved, and never use someone else's key.</p>

        <div class="row-set" style="cursor:default">
          <span class="row-text"><b>On-device AI (Chrome)</b><small id="odStatus">Checking…</small></span>
          <button class="btn" id="odBtn" type="button" disabled>…</button>
        </div>
        <details class="set-more">
          <summary>How to connect Gemini</summary>
          <ol>
            <li>Get a free key at <b>aistudio.google.com/apikey</b></li>
            <li>Open <a href="/setup" target="_blank" rel="noopener" style="color:rgb(var(--eye))"><b>the key page</b></a> on this computer and paste it there. It goes straight to a private file on your computer and is tested with Google. No restart needed.</li>
            <li>Or, in a terminal, run <code>python3 serve.py --set-key</code> and paste it at the hidden prompt.</li>
          </ol>
          <p class="set-note">The key is never kept in the app or the browser.</p>
          <div class="set-name"><input id="setBackend" type="text" value="${escapeHtml(url)}" placeholder="…or your own backend URL" autocomplete="off" spellcheck="false"><button class="btn" id="setBackendSave" type="button">Save</button></div>
        </details>
      </section>

      <section class="set-card">
        <h3>Memory</h3>
        <p class="set-note" id="memLine">${memoryLine()}</p>
        <button class="btn" id="setForget" type="button">Forget me</button>
      </section>

      <section class="set-card">
        <h3>Developer tools</h3>
        ${toggle('setDebug', 'Show the debug button', 'A small button on the Quark and game pages that opens the tools below.', settings.get('debugTools'))}
        <div class="dbg-launch">
          <button class="btn" type="button" data-dbg="mic">Mic debug</button>
          <button class="btn" type="button" data-dbg="turns">Conversation debug</button>
          <button class="btn" type="button" data-dbg="lab">Emotion Lab</button>
        </div>
        <p class="set-note">Live records of the microphone and of every call to the brain, and a screen that puts Quark in each emotion. Nothing is sent anywhere or saved.</p>
      </section>

      <p class="home-foot">${CONFIG.build.replace('stage 1 · ', '')} · Quark is a pet, not a tool.</p>
      <div class="toast" id="toast" hidden></div>
    `;

    const $ = (s) => settingsEl.querySelector(s);
    const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2200); };

    $('.set-back').addEventListener('click', () => q.router.go('home'));
    $('#setName').addEventListener('input', (e) => { $('#wakePreview').textContent = e.target.value.trim() || 'Quark'; });
    $('#setNameSave').addEventListener('click', () => {
      const v = $('#setName').value.trim().replace(/\s+/g, ' ').slice(0, 16);
      if (!v) { toast('Give your robot a name first'); return; }
      settings.set('name', v);
      q.ui?.refreshLabels?.();
      q.cam?.refreshLabels?.();
      toast(`Saved! It will answer to “${v}” now.`);
    });
    $('#vcOpen').addEventListener('click', () => q.router.go('voice'));
    $('#setSound').addEventListener('change', (e) => { q.audio.unlock(); q.setSound(e.target.checked); });
    $('#setVoice').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      settings.set('voice', b.dataset.v === 'beeps' ? 'beeps' : 'speech');
      settings.set('naturalVoice', b.dataset.v === 'natural');
      q.tts.forgetFailure();
      $('#setVoice').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      $('#voiceNote').textContent = voiceNote();
    });
    $('#setFace').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-f]');
      if (!b) return;
      settings.set('faceStyle', b.dataset.f);
      q.face.setStyle(b.dataset.f);
      $('#setFace').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    });
    $('#setSpeechLang').addEventListener('change', (e) => { settings.set('speechLang', e.target.value); q.listen.stop?.(); q.listen.kick?.(); });
    $('#setVoiceName').addEventListener('change', (e) => { settings.set('voiceName', e.target.value); });
    $('#setVoiceRate').addEventListener('input', (e) => { settings.set('voiceRate', Number(e.target.value)); });
    $('#setVoiceRobot').addEventListener('input', (e) => { settings.set('voiceRobot', Number(e.target.value)); });
    $('#voiceTestBtn').addEventListener('click', async () => {
      const btn = $('#voiceTestBtn');
      const emotion = $('#voiceTestEmotion').value;
      const lines = { happy: 'Hey, you! I am so glad you are here.', excited: 'Oh wow, that is amazing! Tell me everything!', curious: 'Hmm, wait. How does that even work?', content: 'Everything is nice and quiet right now.', bored: 'Nothing is happening. Nothing at all. Fascinating.', sleepy: 'I think I will rest my eyes for a little while.', startled: 'Whoa! Where did you come from?', scared: 'Did you hear that? I think something moved.', sulky: 'No. I am not talking to you right now.', sad: 'I just feel a little down today, that is all.', angry: 'That is the third time. Seriously. Stop it.' };
      btn.disabled = true;
      q.audio.unlock();
      q.voice.unlock();
      q.tts.forgetFailure();
      const note = $('#voiceTestNote');
      note.textContent = 'Getting the voice…';
      const t0 = performance.now();
      const started = new Promise((r) => { const off = () => r(); q.voice.on('start', off); });
      q.voice.say(lines[emotion], { emotion, tone: 'normal', natural: true }).then(() => {
        const st = q.tts.status;
        note.textContent = st.engine === 'natural' ? `Natural voice (Gemini), ready in ${(st.ms / 1000).toFixed(1)} s.` : `Used the browser voice instead (${st.error || 'natural voice is off'}).`;
        btn.disabled = false;
      });
      await started;
    });
    $('#setHands').addEventListener('change', (e) => { settings.set('handsFree', e.target.checked); toast(e.target.checked ? 'Hands-free will start on the Quark page' : 'Hands-free is off'); });
    $('#setCamForget').addEventListener('click', () => { settings.set('cameraConsent', false); q.cam?.turnOff?.(); renderSettings(); });
    // your own Gemini key: saved only on this device, sent only to Google, shown only as its last 4 characters
    const gkPaint = (busy = false) => {
      const s = ownKey.status;
      const box = $('#gkStatus');
      let state = s.state, text;
      if (busy) { state = 'testing'; text = 'Checking the key with Google…'; }
      else if (s.state === 'ok') text = `Working. Quark chats with Gemini (key ends in ${ownKey.tail()}).`;
      else if (s.state === 'error') text = `Problem: ${s.reason}`;
      else if (s.state === 'saved') text = `Saved on this device (ends in ${ownKey.tail()}). Press Save & test to check it.`;
      else text = 'No key yet. Quark cannot chat until you add one.';
      box.dataset.state = state;
      $('#gkStatusText').textContent = text;
    };
    gkPaint();
    // how much Quark has used today: counted here, because Google does not tell an app how much of the free allowance is left
    const gkUsagePaint = () => {
      const box = $('#gkUsage');
      if (!box) return;
      const r = usageReport();
      if (!ownKey.has() && !r.week.requests) { box.hidden = true; return; }
      const top = Math.max(1, ...r.today.models.map((m) => m.requests));
      const outBy = new Map(r.out.map((o) => [o.model, o]));
      const rows = r.today.models.map((m) => {
        const o = outBy.get(m.model);
        return `<div class="gk-row"><span class="gk-name" title="${escapeHtml(m.model)}">${escapeHtml(m.model)}</span><span class="gk-bar"><i style="width:${Math.max(4, Math.round(100 * m.requests / top))}%"></i></span><span class="gk-n">${m.requests}${o ? ` <em class="gk-out">${o.kind === 'quota' ? 'out for today' : 'resting'}</em>` : ''}</span></div>`;
      });
      for (const o of r.out) if (!r.today.models.some((m) => m.model === o.model)) rows.push(`<div class="gk-row"><span class="gk-name" title="${escapeHtml(o.model)}">${escapeHtml(o.model)}</span><span class="gk-bar"></span><span class="gk-n"><em class="gk-out">${o.kind === 'quota' ? 'out for today' : 'resting'}</em></span></div>`);
      const fmt = (n) => n.toLocaleString();
      const outNote = r.out.some((o) => o.kind === 'quota') ? `<p class="gk-note">Models marked “out for today” come back ${escapeHtml(whenText(r.resetAt))}.</p>` : '';
      box.innerHTML = `
        <div class="gk-head"><span>Used today</span><small>resets ${escapeHtml(whenText(r.resetAt))}</small></div>
        <div class="gk-stats">
          <div class="gk-stat"><b>${fmt(r.today.messages)}</b><span>${r.today.messages === 1 ? 'message' : 'messages'}</span></div>
          <div class="gk-stat"><b>${fmt(r.today.requests)}</b><span>${r.today.requests === 1 ? 'request' : 'requests'}</span></div>
          <div class="gk-stat"><b>${fmt(r.today.tokens)}</b><span>tokens</span></div>
        </div>
        ${rows.length ? `<div class="gk-models">${rows.join('')}</div>` : ''}
        ${outNote}
        <p class="gk-note">This week: ${fmt(r.week.messages)} ${r.week.messages === 1 ? 'message' : 'messages'}${r.today.limited ? ` · Google turned away ${fmt(r.today.limited)} ${r.today.limited === 1 ? 'request' : 'requests'} today` : ''}. These are Quark's own counts for this browser. Google's exact numbers are at <a href="https://aistudio.google.com/usage" target="_blank" rel="noopener noreferrer" style="color:rgb(var(--eye))">aistudio.google.com/usage</a>.</p>`;
      box.hidden = false;
    };
    gkUsagePaint();
    if (gkUsageOff) gkUsageOff();
    gkUsageOff = onUsageChange(() => { if (document.getElementById('gkUsage')) gkUsagePaint(); else { gkUsageOff?.(); gkUsageOff = null; } });
    $('#gkEye').addEventListener('click', () => {
      const k = $('#gkKey'), show = k.type === 'password';
      k.type = show ? 'text' : 'password';
      $('#gkEye').setAttribute('aria-pressed', String(show));
    });
    $('#gkSave').addEventListener('click', async () => {
      const typed = $('#gkKey').value.trim();
      if (typed) {
        const r = ownKey.save(typed);
        if (!r.ok) { toast(r.error); return; }
        $('#gkKey').value = ''; $('#gkKey').type = 'password'; $('#gkEye').setAttribute('aria-pressed', 'false');
        $('#gkKey').placeholder = `Saved, ends in ${ownKey.tail()}. Paste a new key to replace it`;
        if (r.error) toast(r.error);
      } else if (!ownKey.has()) { toast('Paste your Gemini key first.'); return; }
      gkPaint(true);
      const t = await testKey();
      gkPaint();
      $('#brainLine').textContent = brainText(brainKind(), getConfiguredUrl());
      toast(t.ok ? 'Key works! Quark can chat now.' : t.error);
    });
    $('#gkRemove').addEventListener('click', (e) => {
      const b = e.currentTarget;
      if (b.dataset.sure !== '1') {
        b.dataset.sure = '1'; b.textContent = 'Tap again to remove it';
        setTimeout(() => { b.dataset.sure = ''; b.textContent = 'Remove key'; }, 4000);
        return;
      }
      ownKey.remove();
      renderSettings();
      toast('Key removed.');
    });
    $('#setBackendSave').addEventListener('click', async () => {
      settings.set('backendUrl', $('#setBackend').value.trim().replace(/\/+$/, ''));
      await discoverBrain();
      $('#brainLine').textContent = brainText(brainKind(), getConfiguredUrl());
      toast('Saved');
    });
    // on-device AI: Chrome's built-in model. Free and private; a one-time download that must start from a tap
    const od = { status: $('#odStatus'), btn: $('#odBtn') };
    const refreshOd = async () => {
      const a = await onDevice.availability();
      const on = settings.get('onDevice') && a === 'available';
      const viaGemini = kind !== 'none' && kind !== 'on-device';
      const note = viaGemini ? ' (Gemini takes priority while it is connected.)' : '';
      od.btn.disabled = false;
      if (a === 'unsupported') { od.status.textContent = 'Not available in this browser. Recent Chrome on a computer has it.'; od.btn.textContent = 'Unavailable'; od.btn.disabled = true; }
      else if (a === 'unavailable') { od.status.textContent = "This device can't run Chrome's built-in AI."; od.btn.textContent = 'Unavailable'; od.btn.disabled = true; }
      else if (a === 'downloadable') { od.status.textContent = 'Free, private, no key. One-time download of about 2 GB.' + note; od.btn.textContent = 'Download & turn on'; }
      else if (a === 'downloading') { od.status.textContent = 'Downloading…'; od.btn.textContent = 'Working…'; od.btn.disabled = true; }
      else if (on) { od.status.textContent = "On. Quark chats using Chrome's built-in AI, right on this device." + note; od.btn.textContent = 'Turn off'; }
      else { od.status.textContent = 'Downloaded and ready.' + note; od.btn.textContent = 'Turn on'; }
    };
    od.btn.addEventListener('click', async () => {
      const a = await onDevice.availability();
      if (a === 'available' && settings.get('onDevice')) { onDevice.disable(); toast('On-device AI is off'); return refreshOd(); }
      if (a === 'available') { settings.set('onDevice', true); toast('On-device AI is on'); return refreshOd(); }
      od.btn.disabled = true;
      try {
        await onDevice.enable((p) => { od.btn.textContent = `${Math.round(p * 100)}%`; od.status.textContent = `Downloading… ${Math.round(p * 100)}%`; });
        toast('On-device AI is ready');
      } catch (e) { toast('Could not download: ' + String(e.message || e).slice(0, 60)); }
      refreshOd();
    });
    refreshOd();

    $('#setDebug').addEventListener('change', (e) => { settings.set('debugTools', e.target.checked); q.debug?.syncChip(); toast(e.target.checked ? 'Debug button on' : 'Debug button off'); });
    settingsEl.querySelectorAll('[data-dbg]').forEach((b) => b.addEventListener('click', () => q.debug?.open(b.dataset.dbg)));
    $('#setForget').addEventListener('click', () => { memory.forget(); $('#memLine').textContent = memoryLine(); toast('Quark forgot everything about you'); });

    if (pendingToast) { toast(pendingToast); pendingToast = ''; }

    // ---- Adult / Kid / Focus
    $('#setMode').addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-m]');
      if (!b) return;
      const want = b.dataset.m;
      if ((want === 'kid') === q.profile.kid) return;
      if (want === 'kid') {
        if (!hasPin()) {
          const ok = await q.pin.ask({ mode: 'create', title: 'Set a parent PIN', sub: 'Choose four digits. Kid mode stays locked until this PIN is entered.' });
          if (!ok) return;
        }
        settings.set('mode', 'kid');
        settings.set('focus', false);
        if (q.listen?.handsFree) { q.listen.setHandsFree(false); settings.set('handsFree', false); }
      } else {
        const ok = await q.pin.ask({ mode: 'verify', title: 'Parent PIN', sub: 'Enter the PIN to switch Kid mode off.' });
        if (!ok) { toast('Kid mode stays on'); return; }
        settings.set('mode', 'adult');
      }
      memory.setMode(settings.get('mode'));
      q.chat.variety.reset();
      q.emotion.set('content', 35, 'mode');
      pendingToast = settings.get('mode') === 'kid' ? 'Kid mode is on' : 'Adult mode is on';
      renderSettings();
    });
    $('#setFocus').addEventListener('change', (e) => { settings.set('focus', e.target.checked); toast(e.target.checked ? 'Focus buddy on: Quark will keep quiet' : 'Focus buddy off'); });
    $('#setPin').addEventListener('click', async () => {
      if (!(await q.pin.ask({ mode: 'verify', title: 'Parent PIN', sub: 'Enter the current PIN first.' }))) return;
      if (await q.pin.ask({ mode: 'create', title: 'New parent PIN', sub: 'Choose four new digits.' })) toast('PIN changed');
    });
  }

  function brainText(kind, url) {
    if (kind === 'none') return 'Quark has no brain connected, so it cannot chat yet. Paste your own free Gemini key (below), or turn on on-device AI (Chrome).';
    if (kind === 'own key') {
      const st = ownKey.status;
      if (st.state === 'error') return `Your Gemini key is not working, so Quark cannot chat yet (${st.reason}) Fix it below.`;
      return 'Chatting with Gemini using your own key. Your messages go straight from this device to Google.';
    }
    if (kind === 'on-device') return "Chatting with Chrome's built-in AI, right on this device. Nothing you say leaves it.";
    return `Connected to Gemini through ${kind === 'dev server' ? 'the dev server' : escapeHtml(url)}. Quark can talk about anything.`;
  }

  function voiceKind() { return settings.get('voice') === 'beeps' ? 'beeps' : settings.get('naturalVoice') ? 'natural' : 'speech'; }
  function voiceNote() {
    const k = voiceKind();
    if (k === 'beeps') return 'Chirps and beeps only. Subtitles always stay on.';
    if (k === 'speech') return "The browser's own voice, with chirps. Needs a voice installed on your device.";
    return getConfiguredUrl() || brainKind() === 'dev server' ? 'Gemini speech: natural and expressive. Falls back to the browser voice if it is busy.' : 'Needs the Gemini brain (below). Until then Quark uses the browser voice.';
  }

  function memoryLine() {
    const u = memory.userName, s = memory.summary, nf = memory.facts.length;
    if (!u && !s && !nf) return 'Quark does not know anything about you yet.';
    return `${u ? `Quark knows your name is ${escapeHtml(u)}. ` : ''}${s ? `What it remembers: “${escapeHtml(s)}” ` : ''}${nf ? `It also keeps ${nf} small fact${nf > 1 ? 's' : ''} about you. ` : ''}This only lives in this browser, and only short text is ever sent to the brain.`;
  }

  /** One line for the Settings card: where the custom voice stands, in plain words. */
  function vcLine() {
    const i = q.cloud.info();
    if (!i.hasCreds) return 'Not connected. Quark uses the chirp voice. Paste an ElevenLabs key and Voice ID to give it your voice.';
    if (i.status.state === 'connected') return `Connected and working (key ending ${i.keyTail}).`;
    if (i.status.state === 'error') return `Problem: ${i.status.reason}`;
    return `Saved on this device (key ending ${i.keyTail}). Open it and press Test voice.`;
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  renderHome();
  renderSettings();

  return {
    /** Called by the router whenever the page changes: refresh anything that may have changed. */
    onPage(page) {
      if (page === 'home') renderHome();
      if (page === 'settings') { renderSettings(); discoverBrain().then(() => { const el = settingsEl.querySelector('#brainLine'); if (el) el.textContent = brainText(brainKind(), getConfiguredUrl()); const vn = settingsEl.querySelector('#voiceNote'); if (vn) vn.textContent = voiceNote(); }); }
    },
  };
}
