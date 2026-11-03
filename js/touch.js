// Pointer-event gesture recogniser.
//   quick tap (< punchMaxMs, barely moved)        -> onPunch
//   held (or moved slowly) for petMinMs or longer -> onPetStart ... onPetMove ... onPetEnd
//   in between                                    -> onBoop
// Works the same for finger, mouse and pen. Only the first pointer counts.

export function attachTouch(el, handlers, cfg) {
  let st = null;
  const h = (name, ...a) => { try { handlers[name]?.(...a); } catch (e) { console.error(e); } };

  const point = (e) => {
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return { x, y, nx: (x / r.width) * 2 - 1, ny: (y / r.height) * 2 - 1, w: r.width, h: r.height };
  };

  const effSpeed = (s, now) => (now - s.lastMove > 130 ? 0 : s.speed); // standing still = speed 0

  function check() {
    if (!st) return;
    const now = performance.now();
    const age = now - st.t0;
    const speed = effSpeed(st, now);
    if (!st.petting && !st.rough && age >= cfg.petMinMs && speed <= cfg.petMaxSpeed) {
      st.petting = true;
      st.roughSince = 0;
      h('onPetStart', point(st.last));
    } else if (st.petting) {
      if (speed > cfg.petMaxSpeed * 2.4) {
        if (!st.roughSince) st.roughSince = now;
        else if (now - st.roughSince > 260) { // scrubbing too hard isn't petting
          st.petting = false;
          st.rough = true;
          h('onPetEnd', { reason: 'rough', ms: now - st.petStart });
        }
      } else st.roughSince = 0;
    }
  }

  el.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || st) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const now = performance.now();
    st = {
      id: e.pointerId, t0: now, x0: e.clientX, y0: e.clientY, last: e, path: 0, speed: 0, lastMove: now, lastT: now,
      petting: false, petStart: now + cfg.petMinMs, rough: false, roughSince: 0,
      timer: setInterval(check, 60),
    };
    h('onDown', point(e));
  });

  el.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    const now = performance.now();
    const dx = e.clientX - st.last.clientX, dy = e.clientY - st.last.clientY;
    const dist = Math.hypot(dx, dy);
    const dt = Math.max(now - st.lastT, 1);
    st.speed = st.speed * 0.6 + (dist / dt) * 0.4;
    st.path += dist;
    st.lastT = now;
    st.lastMove = now;
    st.last = e;
    const p = point(e);
    h('onMove', p);
    if (st.petting) h('onPetMove', p);
  });

  function end(e, cancelled) {
    if (!st || e.pointerId !== st.id) return;
    const s = st;
    st = null;
    clearInterval(s.timer);
    const now = performance.now();
    const age = now - s.t0;
    const p = point(e);
    if (s.petting) h('onPetEnd', { reason: 'release', ms: now - s.petStart });
    else if (!cancelled && age < cfg.punchMaxMs && s.path < cfg.punchMaxMove) h('onPunch', p);
    else if (!cancelled && age < cfg.petMinMs && s.path < 60) h('onBoop', p);
    h('onUp', p);
  }
  el.addEventListener('pointerup', (e) => end(e, false));
  el.addEventListener('pointercancel', (e) => end(e, true));
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  return { get active() { return !!st; } };
}
