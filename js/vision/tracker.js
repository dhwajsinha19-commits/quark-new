// The eyes: owns the camera, runs the face/hand/pose landmarkers (or the plain motion sensor if they can't
// load), and turns what it sees into a short list of events plus a "where is the person" gaze point.
//
//   events:  found, away, back, approach, retreat, wave, thumbsup, highfive, jump, dance-start, dance-end, sudden, still
//   gaze:    onGaze(x, y) in -1..1 (x already mirrored so Quark looks *toward* the person), or onGaze(null)
//
// Privacy: frames never leave this file's call chain. Nothing is stored, nothing is sent anywhere; only event
// names (and the short text hints chat.js builds from them) ever travel on.
//
// Battery: ~15 fps while there's something to see, ~5 fps when the room has been empty or still for a while,
// paused while the page is hidden or Quark is asleep. Hands are only polled at full rate when one is in view;
// pose runs at a third of the rate.

import { createCamera } from './camera.js';
import { createMotionSensor } from './framediff.js';
import { loadLandmarkers } from './landmarks.js';
import { classifyHand, WaveDetector, Hold, FaceMotion, BodyEnergy } from './gestures.js';

const FAST_MS = 66;        // ~15 fps
const SLOW_MS = 200;       // ~5 fps
const PAUSED_MS = 500;

export function createTracker({ onEvent, onGaze, onState, shouldRun }) {
  const camera = createCamera({ onState: (s) => { if (s !== 'on') set(s); } });
  const motion = createMotionSensor();
  const faceM = new FaceMotion();
  const body = new BodyEnergy();
  const wave = new WaveDetector();
  const thumbHold = new Hold(450);
  const fiveHold = new Hold(650);

  let state = 'off';
  let engine = 'none';            // 'mediapipe' | 'motion'
  let lm = null;
  let timer = 0;
  let lastVideoTime = -1;
  let tickN = 0;
  let errors = 0;
  let loadError = '';
  let lastActivity = 0;
  let lastPresence = 0;
  let stillSent = 0;
  let handSeenAt = 0;
  let lastWave = 0;
  let lostFlat = 0;               // when the hand stopped looking flat (0 = it still does)
  let flatSince = 0;              // when the hand last became a flat, upright palm
  let wristPrev = null;
  let suddenAt = 0;
  let phoneUntil = 0;
  let lastJump = 0;
  let lowPower = false;
  const stats = { fps: 0, ms: 0, frames: 0, since: 0, hand: '-', flat: false, face: false, phone: false, delegate: '-', pose: false, energy: 0 };
  let hand = null;                // latest hand description (also used by the rock-paper-scissors game later)
  let testSource = null;          // tests only: a canvas to read frames from instead of the camera
  const aspectNow = () => (testSource ? testSource.width / testSource.height : camera.aspect);

  function set(s) {
    if (s === state) return;
    state = s;
    onState?.(s, info());
  }
  const info = () => ({ engine, loadError, delegate: stats.delegate });
  const emit = (type, extra) => onEvent?.({ type, ...extra });

  // ------------------------------------------------------------------ per-engine frame handling

  function markActive(t) { lastActivity = t; if (lowPower) lowPower = false; }

  function runMediaPipe(t, v, phone) {
    const aspect = aspectNow();
    const fr = lm.face.detectForVideo(v, t);
    const f = (fr.faceLandmarks && fr.faceLandmarks[0]) || null;
    stats.face = !!f;
    for (const type of faceM.update(t, f, { aspect, phoneMoving: phone })) {
      if (type === 'jump') lastJump = t;
      // a jump or a dance is fast too, but it isn't a startle
      if (type === 'sudden' && (t - suddenAt < 8000 || t - lastJump < 2500 || faceM.dancing)) continue;
      if (type === 'sudden') suddenAt = t;
      emit(type);
    }
    if (f) {
      lastPresence = t;
      onGaze?.(-(faceM.cx - 0.5) * 2.6, (faceM.cy - 0.5) * 2.2);
      if (faceM.speed > 0.35) markActive(t);
    } else onGaze?.(null);

    // hands: every frame when one is in view, otherwise a quick look every third frame
    if (lm.hands && (t - handSeenAt < 1500 || tickN % 3 === 0)) {
      const hr = lm.hands.detectForVideo(v, t);
      let best = null;
      for (const h of hr.landmarks || []) {
        const c = classifyHand(h, aspect);
        if (!best || c.palm > best.palm) best = c;
      }
      if (best) {
        handSeenAt = t;
        markActive(t);
        hand = { ...best, t };
        stats.hand = best.shape;
        // a wave is a FLAT open hand, fingers up, sweeping side to side. It has to be flat for a moment before the sweep counts, and
        // the swing it must make scales with the size of the hand (about half a palm), so it works near and far
        stats.flat = best.flat;
        if (best.flat && best.upright) {
          lostFlat = 0;
          if (!flatSince) flatSince = t;
          const swing = Math.min(0.16, Math.max(0.04, 0.5 * best.palm / aspect));
          if (t - flatSince >= 300 && wave.push(t, best.x, best.y, swing)) { lastWave = t; emit('wave'); }
        } else {
          // the landmarker flickers between 3 and 4 fingers mid-wave: a quarter of a second of not-flat is forgiven
          if (!lostFlat) lostFlat = t;
          if (t - lostFlat > 250) { flatSince = 0; wave.reset(); }
        }
        if (thumbHold.update(t, best.shape === 'thumbsup')) emit('thumbsup');
        // a high-five is an open palm held up and *still*, as opposed to a wave
        const speed = wristPrev ? Math.hypot(best.wrist.x - wristPrev.x, best.wrist.y - wristPrev.y) / Math.max((t - wristPrev.t) / 1000, 0.03) : 9;
        wristPrev = { x: best.wrist.x, y: best.wrist.y, t };
        const still = speed < 0.3 && t - lastWave > 1500;
        if (fiveHold.update(t, best.shape === 'paper' && best.upright && best.palm > 0.07 && still)) emit('highfive');
      } else if (t - handSeenAt > 600) {
        hand = null;
        stats.hand = '-';
        wave.reset(); flatSince = 0; lostFlat = 0; stats.flat = false; thumbHold.reset(); fiveHold.reset(); wristPrev = null;
      }
    }

    // pose: whole-body energy, a third as often
    if (lm.pose && tickN % 3 === 1) {
      const pr = lm.pose.detectForVideo(v, t);
      const pl = (pr.landmarks && pr.landmarks[0]) || null;
      const e = body.update(t, pl, aspect);
      stats.energy = e;
      if (pl) { lastPresence = Math.max(lastPresence, t); if (e > 0.6) markActive(t); }
      if (!phone && e > 3.2 && t - suddenAt > 8000 && t - lastJump > 2500 && !faceM.dancing) { suddenAt = t; emit('sudden'); }
    }
  }

  function runMotionOnly(t, ms) {
    if (!ms || ms.phone) { onGaze?.(null); return; }
    stats.energy = ms.energy;
    if (ms.energy > 0.012) {
      markActive(t);
      lastPresence = t;
      onGaze?.(-(ms.cx - 0.5) * 2.2, (ms.cy - 0.5) * 1.6);
    } else onGaze?.(null);
    // no wave here: without hand tracking there is no way to tell a flat waving hand from a head turn or a typing arm
    if (ms.energy > 0.4 && t - suddenAt > 8000) { suddenAt = t; emit('sudden'); }
  }

  // ------------------------------------------------------------------ the loop

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(tick, Math.max(0, ms));
  }

  function tick() {
    timer = 0;
    if (state !== 'on') return;
    if (!shouldRun()) { onGaze?.(null); schedule(PAUSED_MS); return; }
    const v = testSource || camera.video;
    if (!testSource) {
      if (!v || v.readyState < 2 || v.currentTime === lastVideoTime) { schedule(25); return; }
      lastVideoTime = v.currentTime;
    }

    const t0 = performance.now();
    tickN++;
    try {
      const ms = motion.sample(v);
      // while the room behind you slides as one block, the phone is moving, not you; keep ignoring movement
      // for a moment after it settles so the person reappearing in a new spot isn't mistaken for a jump
      if (ms && ms.phone) phoneUntil = t0 + 800;
      const phone = t0 < phoneUntil;
      stats.phone = phone;
      if (engine === 'mediapipe') runMediaPipe(t0, v, phone);
      else runMotionOnly(t0, phone ? { ...ms, phone: true } : ms);
      errors = 0;
    } catch (e) {
      console.warn('tracker frame failed', e);
      if (++errors >= 4 && engine === 'mediapipe') { loadError = String(e && e.message ? e.message : e); useFallback(); }
    }

    // someone has been around: note it. Nobody/nothing for a while: slow down to save battery.
    if (t0 - Math.max(lastActivity, lastPresence) > 30000) lowPower = true;
    if (lastPresence && t0 - lastPresence < 2000 && t0 - lastActivity < 8000) lowPower = false;

    // "no movement for a while" while someone is clearly there
    if (stats.face && t0 - lastActivity > 25000 && t0 - stillSent > 45000) { stillSent = t0; emit('still'); }

    const cost = performance.now() - t0;
    stats.ms += (cost - stats.ms) * 0.2;
    stats.frames++;
    if (t0 - stats.since >= 1000) { stats.fps = Math.round((stats.frames * 1000) / (t0 - stats.since)); stats.frames = 0; stats.since = t0; }
    schedule((lowPower ? SLOW_MS : FAST_MS) - cost);
  }

  function useFallback() {
    engine = 'motion';
    try { lm?.close(); } catch { /* ignore */ }
    lm = null;
    stats.delegate = '-';
    onState?.(state, info());
  }

  // ------------------------------------------------------------------ public

  async function start() {
    if (state === 'on' || state === 'loading' || state === 'asking') return state === 'on';
    set('asking');
    const ok = await camera.start();
    if (!ok) { set(camera.state === 'on' ? 'error' : camera.state); return false; }
    set('loading');
    try {
      try { lm?.close(); } catch { /* ignore */ }
      lm = await loadLandmarkers();
      engine = 'mediapipe';
      stats.delegate = lm.delegate;
      setTimeout(() => lm && lm.loadPose().then(() => { stats.pose = !!(lm && lm.pose); }), 1500);
    } catch (e) {
      loadError = String(e && e.message ? e.message : e);
      console.warn('MediaPipe unavailable, using plain motion sensing:', e);
      engine = 'motion';
    }
    motion.reset();
    lastActivity = lastPresence = performance.now();
    lowPower = false;
    set('on');
    schedule(0);
    return true;
  }

  function stop() {
    clearTimeout(timer);
    timer = 0;
    camera.stop();
    try { lm?.close(); } catch { /* ignore */ }
    lm = null;
    engine = 'none';
    hand = null;
    onGaze?.(null);
    set('off');
  }

  return {
    start, stop,
    get state() { return state; },
    get engine() { return engine; },
    get stats() { return stats; },
    get hand() { return hand; },
    get video() { return camera.video; },
    get loadError() { return loadError; },
    /** Tests only. */
    _useTestSource(canvas) { testSource = canvas; },
    get _faceMotion() { return faceM; },
  };
}
