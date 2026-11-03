// The Quark page controller: builds every part, wires them together, and exposes one object (q)
// that the lab panel, the console (window.quark) and later stages (chat, camera, games) all talk to.

import { CONFIG } from './config.js';
import { settings } from './storage.js';
import * as audio from './audio.js';
import * as haptics from './haptics.js';
import { createFace } from './face.js';
import { createFx } from './fx.js';
import { createSubtitles } from './subtitles.js';
import { createVoice } from './voice.js';
import { createTTS } from './tts.js';
import { createMood, MOOD_OF, EMOTION_OF } from './mood.js';
import { createEmotion } from './emotion.js';
import { createGestures } from './quark-gestures.js';
import { createPetLife } from './pet-life.js';
import { createTemper } from './temper.js';
import { memory } from './memory.js';
import { hasPin, askPin } from './pin.js';
import { createIdle } from './idle.js';
import { createReactions } from './reactions.js';
import { createChat } from './chat.js';
import { mountChatUI } from './chat-ui.js';
import { mountCameraUI } from './camera-ui.js';
import { createRouter } from './router.js';
import { createEndings } from './endings.js';
import { mountHome } from './home.js';
import { createCloudVoice } from './voiceconn.js';
import { mountVoiceScreen } from './voicescreen.js';
import { mountDebug } from './debug-ui.js';
import { discoverBrain } from './brain.js';
import { attachTouch } from './touch.js';

export function createQuark(dom) {
  const q = {
    dom,
    settings,
    audio,
    haptics,
    state: { asleep: true, firstBoot: true },
    locked: false,           // true while a sequence (wake, crack & reform) owns the screen
    name: () => settings.get('name'),
    // who Quark is talking to: an adult (optionally with the quiet "focus buddy" sub-mode) or a child (Kid mode, parent PIN)
    profile: {
      get kid() { return settings.get('mode') === 'kid'; },
      get focus() { return settings.get('mode') !== 'kid' && !!settings.get('focus'); },
    },
    pin: { has: hasPin, ask: askPin },
  };
  memory.setMode(q.profile.kid ? 'kid' : 'adult');          // Kid mode has its own, smaller memory

  q.face = createFace(dom.faceMount);
  q.subtitles = createSubtitles(dom.subtitles);
  q.tts = createTTS();
  q.voice = createVoice({ subtitles: q.subtitles, getName: q.name, tts: q.tts });
  q.fx = createFx({ world: dom.world, layer: dom.fxLayer, face: q.face, audio });
  q.mood = createMood(q);
  q.emotion = createEmotion();

  // emotion <-> mood: the brain reports an emotion and the resting face follows; touch and idle life set a mood
  // and the emotion (which the brain reads on the next message) follows that
  let fromEmotion = false;
  q.emotion.onChange(() => {
    fromEmotion = true;
    q.mood.set(MOOD_OF[q.emotion.name], { force: true, expression: q.emotion.expression() });
    fromEmotion = false;
  });
  q.mood.onChange((m) => {
    if (fromEmotion) return;
    const [name, intensity] = EMOTION_OF[m] || ['content', 35];
    q.emotion.set(name, intensity, 'reaction', { silent: true });
  });
  q.idle = createIdle(q);
  q.chat = createChat(q);
  q.reactions = createReactions(q);
  q.endings = createEndings(q);
  q.gesture = createGestures(q);
  q.petLife = createPetLife(q);                     // things Quark does on its own while nobody is talking to it
  q.temper = createTemper(q);                       // its four main feelings (happy, sulky, smug, angry) and what sets them off

  haptics.bindShaker(dom.world);
  audio.setEnabled(settings.get('sound'));

  /** Quark speaks. Tone follows the current emotion unless a line says otherwise. A pet name is never used twice. */
  q.say = (text, opts = {}) => q.voice.say(q.chat.variety.filterSentence(text, { dedupe: false }) || text, { tone: q.emotion.tone(), emotion: q.emotion.name, intensity: q.emotion.intensity, ...opts });

  // ---- hint line ("tap to wake", "hold to pet")
  let hintTimer = 0;
  q.hint = (text, ms = 0) => {
    clearTimeout(hintTimer);
    if (!text) { dom.hint.classList.remove('on'); return; }
    dom.hint.textContent = text;
    dom.hint.classList.add('on');
    if (ms) hintTimer = setTimeout(() => dom.hint.classList.remove('on'), ms);
  };

  // ---- the mouth follows the voice, and the microphone stays off while Quark talks (it must never hear itself)
  q.voice.on('start', () => { q.face.setTalking(true); q.listen?.speechStarted(); });
  q.voice.on('end', () => { q.face.setTalking(false); q.listen?.speechEnded(); });
  q.voice.on('pulse', () => q.face.pulseMouth());
  q.voice.on('chunk', () => q.face.pulseMouth());
  q.voice.on('fallback', () => q.subtitles.caption("(no speech voice in this browser, so I'm beeping instead)", 4500));

  // ---- touch
  attachTouch(dom.stage, q.reactions.touchHandlers, CONFIG.touch);

  // ---- talking to Quark: mic, keyboard, hands-free
  q.ui = mountChatUI(q, dom);

  // ---- seeing: camera consent, eye following, gestures
  q.cam = mountCameraUI(q, dom);

  q.debug = mountDebug(q);                           // Mic / Conversation / Emotion Lab (see Settings > Developer tools)

  // ---- pages: Home, Quark, games, Settings
  q.page = 'home';
  q.game = null;
  q.cloud = createCloudVoice();                      // the custom ElevenLabs voice (Settings > Voice Connection); not connected to Quark's speech yet
  q.voiceScreen = mountVoiceScreen(q, { el: dom.voiceEl });
  q.home = mountHome(q, { home: dom.home, settingsEl: dom.settingsEl });
  dom.homeBtn.addEventListener('click', (e) => { e.stopPropagation(); q.router.go('home'); });
  createRouter(q, { app: dom.app, gameLayer: dom.gameLayer, onPage: (p) => { q.home.onPage(p); q.voiceScreen.onPage(p); } });
  discoverBrain();                                   // is there a Gemini brain next door (the dev server's /brain)?

  // ---- sound toggle (subtitles stay on either way)
  const syncSoundBtn = () => dom.soundBtn.setAttribute('aria-pressed', String(!!settings.get('sound')));
  q.setSound = (on) => {
    settings.set('sound', !!on);
    audio.setEnabled(!!on);
    if (!on) q.voice.cancel();
    syncSoundBtn();
  };
  dom.soundBtn.addEventListener('click', (e) => { e.stopPropagation(); audio.unlock(); q.setSound(!settings.get('sound')); });
  syncSoundBtn();

  // ---- sound and speech can only start after a user gesture, and iOS only honours some gestures (touchend, click)
  // so keep trying to unlock on every kind of gesture until both are ready
  const unlockAll = () => { audio.unlock(); q.voice.unlock(); };
  for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(ev, unlockAll, { capture: true, passive: true });

  // ---- Quark never talks or makes noise while the page is in the background
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { q.voice.cancel(); audio.purrStop(true); haptics.stopPurr(); }
  });

  // Quark starts asleep; the router shows "tap to wake" when you open the Quark page.

  return q;
}
