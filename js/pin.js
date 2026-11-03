// The parent PIN: four digits that guard Kid mode. Switching Kid mode off, and opening Settings while it is on, both need it.
//
// Only a salted hash is stored, never the digits. This is a lock for a child's fingers, not a vault: the PIN lives in
// this browser, so someone who clears the site's data resets it. Five wrong tries lock the keypad for a minute.

import { load, save } from './storage.js';

const KEY = 'pin';
const LOCK_KEY = 'pinLock';
const enc = new TextEncoder();

// plain-http pages on a LAN address have no crypto.subtle, so there is a stretched fallback hash
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

async function hashPin(pin, salt) {
  try {
    if (globalThis.crypto && crypto.subtle) {
      const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256);
      return 'p' + [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* fall through */ }
  let h = salt + ':' + pin;
  for (let i = 0; i < 4000; i++) h = String(cyrb53(h, i));
  return 'f' + h;
}

const newSalt = () => Array.from({ length: 8 }, () => Math.floor(Math.random() * 36).toString(36)).join('');

export const hasPin = () => !!load(KEY, null);

export async function setPin(pin) {
  const salt = newSalt();
  save(KEY, { salt, hash: await hashPin(pin, salt) });
}

export const lockedForMs = () => Math.max(0, (load(LOCK_KEY, { until: 0 }).until || 0) - Date.now());

/** true if the PIN is right. Five wrong tries in a row lock the keypad for a minute. */
export async function verifyPin(pin) {
  if (lockedForMs() > 0) return false;
  const rec = load(KEY, null);
  if (!rec) return true;
  const ok = (await hashPin(pin, rec.salt)) === rec.hash;
  const lock = load(LOCK_KEY, { fails: 0, until: 0 });
  if (ok) save(LOCK_KEY, { fails: 0, until: 0 });
  else {
    const fails = (lock.fails || 0) + 1;
    save(LOCK_KEY, { fails: fails >= 5 ? 0 : fails, until: fails >= 5 ? Date.now() + 60000 : 0 });
  }
  return ok;
}

/**
 * Show the keypad. mode 'verify' asks for the existing PIN; mode 'create' asks for a new one twice.
 * Resolves true when it succeeded, false if the person backed out.
 */
export function askPin({ mode = 'verify', title, sub } = {}) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'pin-overlay';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = `
      <div class="pin-card">
        <h2></h2>
        <p class="pin-sub"></p>
        <div class="pin-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div class="pin-msg" role="status" aria-live="polite"></div>
        <div class="pin-pad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-d="${n}">${n}</button>`).join('')}
          <button type="button" data-act="cancel" class="pin-aux">Cancel</button>
          <button type="button" data-d="0">0</button>
          <button type="button" data-act="back" class="pin-aux" aria-label="Delete">⌫</button>
        </div>
      </div>`;
    const $ = (s) => root.querySelector(s);
    const dots = [...root.querySelectorAll('.pin-dots i')];
    let digits = '';
    let first = '';          // create mode: the PIN typed the first time
    let busy = false;
    const createMode = mode === 'create';

    const heading = () => {
      $('h2').textContent = title || (createMode ? 'Set a parent PIN' : 'Parent PIN');
      $('.pin-sub').textContent = createMode && first ? 'Type it once more to confirm.' : (sub || (createMode ? 'Four digits. Kid mode stays locked until this is entered.' : 'Enter the four-digit PIN.'));
    };
    const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < digits.length));
    const say = (msg, bad = false) => { $('.pin-msg').textContent = msg; $('.pin-card').classList.toggle('bad', bad); };
    const shake = () => { const c = $('.pin-card'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); };

    function close(result) {
      document.removeEventListener('keydown', onKey, true);
      root.remove();
      resolve(result);
    }

    async function submit() {
      busy = true;
      if (createMode) {
        if (!first) { first = digits; digits = ''; heading(); say(''); paint(); busy = false; return; }
        if (first !== digits) { first = ''; digits = ''; say('Those did not match. Start again.', true); shake(); heading(); paint(); busy = false; return; }
        await setPin(digits);
        close(true);
        return;
      }
      const wait = lockedForMs();
      if (wait > 0) { digits = ''; paint(); say(`Too many tries. Wait ${Math.ceil(wait / 1000)} seconds.`, true); shake(); busy = false; return; }
      if (await verifyPin(digits)) { close(true); return; }
      digits = '';
      paint();
      say(lockedForMs() > 0 ? 'Too many tries. Locked for a minute.' : 'Wrong PIN. Try again.', true);
      shake();
      busy = false;
    }

    function press(d) {
      if (busy || digits.length >= 4) return;
      digits += d;
      paint();
      say('');
      if (digits.length === 4) submit();
    }
    function back() { if (!busy) { digits = digits.slice(0, -1); paint(); } }

    root.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('button');
      if (!b) { if (e.target === root) close(false); return; }
      if (b.dataset.d) press(b.dataset.d);
      else if (b.dataset.act === 'back') back();
      else if (b.dataset.act === 'cancel') close(false);
    });
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
    function onKey(e) {
      if (/^[0-9]$/.test(e.key)) { press(e.key); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === 'Backspace') { back(); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === 'Escape') { close(false); e.preventDefault(); e.stopPropagation(); }
    }
    document.addEventListener('keydown', onKey, true);

    heading();
    paint();
    document.body.appendChild(root);
  });
}
