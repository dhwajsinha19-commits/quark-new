// The talk-to-Quark controls: big mic button, keyboard fallback, hands-free "Hey <name>" toggle.
// Voice is the main way to chat; typing is always available (voice recognition is unreliable in some browsers).

import { createListener } from './listen.js';
import { settings } from './storage.js';

export function mountChatUI(q, dom) {
  const { app, micBtn, kbBtn, wakeBtn, typeBar, typeInput } = dom;
  const name = () => q.name();

  // ---- typing
  function openTyping(open = true) {
    typeBar.hidden = !open;
    app.classList.toggle('typing', open);
    kbBtn.setAttribute('aria-pressed', String(open));
    if (open) setTimeout(() => typeInput.focus(), 30);
    else typeInput.blur();
  }

  typeBar.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = typeInput.value.trim();
    if (!text) return;
    typeInput.value = '';
    q.audio.unlock();
    q.voice.unlock();
    q.chat.send(text, { source: 'text' });
  });
  typeBar.addEventListener('pointerdown', (e) => e.stopPropagation());
  kbBtn.addEventListener('click', (e) => { e.stopPropagation(); openTyping(typeBar.hidden); });

  // keep the typing bar above the on-screen keyboard
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
  }

  // ---- listening
  const notice = (msg, level) => {
    if (level === 'quiet' && q.chat.followUps > 0) return; // an auto follow-up that heard nothing isn't worth a message
    q.subtitles.caption(msg, 3600);
    if (!q.listen.supported || q.listen.denied) openTyping(true);
  };

  function setMicState(s) {
    micBtn.dataset.state = s;
    micBtn.setAttribute('aria-pressed', String(s === 'listening'));
    wakeBtn.setAttribute('aria-pressed', String(q.listen.handsFree));
    if (s === 'listening') q.face.express('listen', { key: 'listen' });
    else q.face.release('listen');
  }

  q.listen = createListener({
    getName: name,
    isSpeaking: () => q.voice.speaking,
    isConversing: () => q.chat.conversing,
    getLang: () => settings.get('speechLang'),
    wantsNumbers: () => !!(q.game && q.game.id === 'chess'),      // chess squares ("e4") really are digits
    onInterim: (text, final) => {
      q.subtitles.heard(text, { interim: !final });
      q.idle.poke();
      q.face.impulse(0, 1.6, 0); // a tiny nod while it hears you
    },
    onFinal: (text, heard) => {
      q.subtitles.heard(text);
      q.chat.send(text, { source: 'voice', heard }).finally(() => q.listen.kick());
    },
    // the mic opened and heard nothing: a puzzled head-tilt and a soft chirp, no words (a canned "didn't catch that" is exactly what we don't want)
    onNoSpeech: () => {
      if (q.chat.followUps > 0) return;       // an automatic follow-up that heard nothing isn't worth reacting to
      q.face.impulse(0, 0, 0, 6);
      q.audio.chirp('huh');
    },
    onWake: (rest, heard) => {
      q.idle.poke();
      q.chat.resetFollowUps();
      if (rest) q.chat.send(rest, { source: 'voice', heard }).finally(() => q.listen.kick());
      else {
        q.audio.chirp('ask');       // "I'm listening": a rising chirp, not a canned word
        q.face.impulse(0, -6, 0.02);
        q.listen.listenOnce();
      }
    },
    onState: setMicState,
    onNotice: notice,
  });

  micBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    q.audio.unlock();
    q.voice.unlock();
    q.idle.poke();
    if (q.listen.state === 'listening') { q.listen.stop(); return; }
    if (!q.listen.supported || q.listen.denied) { notice(q.listen.denied ? 'The microphone is blocked. Type to me instead!' : "I can't hear in this browser. Type to me instead!"); return; }
    q.hint(null);
    q.voice.cancel();                // tapping the mic while Quark talks interrupts it
    q.chat.resetFollowUps();
    if (q.state.asleep) q.reactions.wake('quiet');
    q.listen.listenOnce();
  });

  wakeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    q.audio.unlock();
    q.voice.unlock();
    const on = !q.listen.handsFree;
    if (q.listen.setHandsFree(on)) {
      settings.set('handsFree', on);
      q.subtitles.caption(on ? `Hands-free on. Say “Hey ${name()}”.` : 'Hands-free off.', 2800);
      if (on && q.state.asleep) q.reactions.wake('quiet');
    }
    wakeBtn.setAttribute('aria-pressed', String(q.listen.handsFree));
  });

  // no mic support at all: say so up front and open the keyboard
  if (!q.listen.supported) {
    micBtn.dataset.state = 'unsupported';
    wakeBtn.hidden = true;
  }

  // the page being hidden turns every microphone off; coming back resumes hands-free only
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) q.listen.pageHidden(); else q.listen.pageVisible();
  });

  // hands-free was on last time: resume it as soon as there's a user gesture (the first wake tap)
  q.afterWake = () => {
    if (settings.get('handsFree') && q.listen.supported && !q.listen.handsFree) q.listen.setHandsFree(true);
  };

  const refreshLabels = () => {
    typeInput.placeholder = `Say something to ${name()}…`;
    micBtn.setAttribute('aria-label', `Talk to ${name()}`);
    wakeBtn.setAttribute('aria-label', `Hands-free: say Hey ${name()}`);
    wakeBtn.title = `Hands-free: say “Hey ${name()}”`;
  };
  refreshLabels();

  return { openTyping, refreshLabels };
}
