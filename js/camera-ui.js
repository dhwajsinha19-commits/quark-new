// The camera controls and consent flow. The camera is OFF until the user taps "Let Quark see me"; while it's on
// there is always a visible "Camera on" pill with a one-tap "Eyes off"; it stops whenever the page is hidden.

import { createTracker } from './vision/tracker.js';
import { createVisionReactions } from './vision-reactions.js';
import { settings } from './storage.js';

export function mountCameraUI(q, dom) {
  const { app, eyeBtn, camPill, camLabel, eyesOffBtn, consent, consentTitle, consentYes, consentNo } = dom;
  const name = () => q.name();
  const vr = createVisionReactions(q);
  q.vision = vr;

  let wantOn = false;       // the user turned the camera on this session (so we can resume after the page was hidden)
  let announced = false;

  const tracker = createTracker({
    onEvent: (e) => { if (e.type !== 'still') vr.resetStill?.(); vr.onEvent(e); },
    onGaze: vr.onGaze,
    onState: (s, info) => render(s, info),
    shouldRun: () => !document.hidden && !q.state.asleep && (!q.router || q.router.active),
  });
  q.tracker = tracker;

  function render(s, info) {
    const live = s === 'on' || s === 'loading';
    eyeBtn.setAttribute('aria-pressed', String(live));
    camPill.hidden = !live;
    camPill.dataset.state = s;
    camLabel.textContent = s === 'loading' ? 'Opening eyes…' : 'Camera on';

    if (s === 'loading') {
      q.face.express('curious', { ms: 2500, key: 'cam' });
      q.subtitles.caption('Opening my eyes…', 2400);
    } else if (s === 'on') {
      if (!announced) {
        announced = true;
        if (info && info.engine === 'motion') q.subtitles.caption("(I can see movement here, but not gestures. That's all this browser lets me do.)", 5000);
        if (!q.state.asleep) { q.face.express('wow', { ms: 900, key: 'cam' }); q.audio.chirp('happy'); q.say(vr.seen(), { tone: 'happy' }); }
      }
    } else if (s === 'denied' || s === 'missing' || s === 'error') {
      wantOn = false;
      q.face.express('sad', { ms: 1400, key: 'cam' });
      q.say(vr.noCam(), { tone: 'sad' });
      q.subtitles.caption(s === 'denied' ? 'Camera permission was blocked.' : s === 'missing' ? 'No camera found.' : 'The camera would not start.', 3800);
    } else if (s === 'off') {
      announced = false;
      vr.stopDance();
      q.face.release('away');
      q.face.releaseGaze(1);
    }
  }

  // ---- consent card
  function showConsent(on = true) {
    consent.hidden = !on;
    app.classList.toggle('consenting', on);
    consentTitle.textContent = `Let ${name()} see you?`;
  }

  async function turnOn() {
    showConsent(false);
    settings.set('cameraConsent', true);
    wantOn = true;
    q.audio.unlock();
    q.idle.poke();
    if (q.state.asleep) q.reactions.wake('quiet');
    await tracker.start();
  }

  function turnOff() {
    wantOn = false;
    tracker.stop();
  }

  eyeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (tracker.state === 'on' || tracker.state === 'loading' || tracker.state === 'asking') { turnOff(); return; }
    // a deliberate tap on the eye button after having agreed once starts it straight away
    if (settings.get('cameraConsent')) turnOn(); else showConsent(true);
  });
  eyesOffBtn.addEventListener('click', (e) => { e.stopPropagation(); turnOff(); });
  consentYes.addEventListener('click', (e) => { e.stopPropagation(); turnOn(); });
  consentNo.addEventListener('click', (e) => { e.stopPropagation(); showConsent(false); });
  consent.addEventListener('pointerdown', (e) => e.stopPropagation());

  // ---- the camera never runs in the background or on another page
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (tracker.state === 'on' || tracker.state === 'loading') tracker.stop(); }
    else if (wantOn) tracker.start();
  });
  addEventListener('pagehide', () => tracker.stop());

  return { turnOn, turnOff, showConsent, tracker, refreshLabels() { consentTitle.textContent = `Let ${name()} see you?`; } };
}
