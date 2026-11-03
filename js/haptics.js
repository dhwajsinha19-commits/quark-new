// Haptics: navigator.vibrate where it exists, a visual shake where it doesn't (iOS Safari).

// Chrome refuses to vibrate until the user has tapped the page once, so check for that too.
const hasVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
const canVibrate = () => hasVibrate && (navigator.userActivation ? navigator.userActivation.hasBeenActive : true);

const PATTERNS = {
  tap: [12],
  boop: [16],
  wake: [18, 40, 18],
  thud: [40],
  punch: [70, 35, 110],
};
const SHAKE_PX = { tap: 3, boop: 3, wake: 4, thud: 6, punch: 9 };

let shaker = null;
let purrLoop = 0;

/** The element that jiggles when the phone can't vibrate. */
export function bindShaker(el) { shaker = el; }

function visualShake(name) {
  if (!shaker || !shaker.animate) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const a = SHAKE_PX[name] ?? 3;
  shaker.animate(
    [
      { transform: 'translate(0,0)' },
      { transform: `translate(${-a}px, ${a * 0.4}px)` },
      { transform: `translate(${a * 0.8}px, ${-a * 0.3}px)` },
      { transform: `translate(${-a * 0.4}px, 0)` },
      { transform: 'translate(0,0)' },
    ],
    { duration: 200, easing: 'ease-out' }
  );
}

/** One-shot buzz. Returns true if the device actually vibrated. */
export function pulse(name) {
  const pattern = PATTERNS[name] ?? [10];
  if (canVibrate()) {
    try { if (navigator.vibrate(pattern)) return true; } catch { /* fall through */ }
  }
  visualShake(name);
  return false;
}

/** Soft rolling buzz while Quark is being petted. */
export function startPurr() {
  stopPurr();
  if (canVibrate()) {
    const burst = () => { try { navigator.vibrate([9, 38, 9, 38, 9, 38, 9, 38, 9, 38, 9, 38]); } catch { /* ignore */ } };
    burst();
    purrLoop = setInterval(burst, 420);
  } else {
    document.body.classList.add('purr-shake'); // fallback: a barely-there tremble of the whole screen
  }
}

export function stopPurr() {
  clearInterval(purrLoop);
  purrLoop = 0;
  document.body.classList.remove('purr-shake');
  if (canVibrate()) { try { navigator.vibrate(0); } catch { /* ignore */ } }
}
