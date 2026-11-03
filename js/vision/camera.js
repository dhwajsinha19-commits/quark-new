// The front camera. It only starts when start() is called from a user tap, it never records or uploads
// anything (frames are only ever handed to on-device code), and stop() releases the hardware completely.
//
// state: 'off' | 'asking' | 'on' | 'denied' | 'missing' | 'error'

export function createCamera({ onState }) {
  let stream = null;
  let video = null;
  let state = 'off';

  const set = (s) => { if (s !== state) { state = s; onState?.(s); } };

  async function start() {
    if (state === 'on' || state === 'asking') return state === 'on';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { set('missing'); return false; }
    set('asking');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'user' }, width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 24 } },
        audio: false,
      });
    } catch (e) {
      const n = e && e.name;
      set(n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError' ? 'denied' : n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError' ? 'missing' : 'error');
      return false;
    }
    video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.muted = true;
    video.autoplay = true;
    video.srcObject = stream;
    // kept in the DOM (iOS insists) but invisible; the picture is never shown to the user or anyone else
    Object.assign(video.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' });
    document.body.appendChild(video);
    stream.getVideoTracks().forEach((t) => t.addEventListener('ended', () => stop()));
    try { await video.play(); } catch { /* autoplay will catch up */ }
    if (video.readyState < 2) await new Promise((r) => { video.addEventListener('loadeddata', r, { once: true }); setTimeout(r, 4000); });
    set('on');
    return true;
  }

  function stop() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (video) { video.srcObject = null; video.remove(); }
    video = null;
    set('off');
  }

  return {
    start, stop,
    get video() { return video; },
    get state() { return state; },
    get aspect() { return video && video.videoWidth ? video.videoWidth / video.videoHeight : 4 / 3; },
  };
}
