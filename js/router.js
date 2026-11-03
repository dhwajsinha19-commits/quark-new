// Pages: 'home' (the grid), 'quark' (full-screen robot), 'game' (a game, with Quark's face up top), 'settings', 'voice' (Voice Connection, opened from Settings).
//
// The URL hash mirrors the page (#/home, #/quark, #/game/chess, #/settings) so Back works and a page can be
// reloaded. Anything that listens or watches (microphone, camera, voice) only runs on 'quark' and 'game' pages,
// and is shut off when you go Home or to Settings.

const GAMES = {
  tap: () => import('./games/tap.js'),
  rps: () => import('./games/rps.js'),
  chess: () => import('./games/chess-game.js'),
  roast: () => import('./games/roast.js'),
};

export function createRouter(q, dom) {
  const { app, gameLayer } = dom;
  let page = 'home';
  let gameId = '';
  let inst = null;
  let navToken = 0;

  const active = () => page === 'quark' || page === 'game';
  q.router = {
    get page() { return page; },
    get gameId() { return gameId; },
    get active() { return active(); },
    go, back: () => go('home'),
  };

  function parse(hash) {
    const m = (hash || '').replace(/^#\/?/, '').split('/');
    if (m[0] === 'quark') return { page: 'quark' };
    if (m[0] === 'settings') return { page: 'settings' };
    if (m[0] === 'voice') return { page: 'voice' };
    if (m[0] === 'game' && GAMES[m[1]]) return { page: 'game', id: m[1] };
    return { page: 'home' };
  }

  function teardown(next) {
    const leavingActive = active();
    if (inst) { try { inst.destroy(); } catch (e) { console.error(e); } inst = null; }
    q.game = null;
    gameLayer.textContent = '';
    q.face.release('game');
    q.fx.clearCrack?.();
    q.fx.stopGlitch?.();
    q.locked = false;
    q.voice.cancel();
    q.chat.cancel?.();
    app.classList.remove('typing');
    // never watch or listen outside the Quark and game pages
    if (next === 'home' || next === 'settings' || next === 'voice') {
      q.cam?.turnOff?.();
      q.listen?.setHandsFree?.(false);
      q.listen?.stop?.();
      q.idle.stopActivities?.();
      q.vision?.stopDance?.();
    } else if (next === 'game' && q.tracker && q.tracker.state !== 'off') {
      // the camera belongs to the Quark page (and to rock-paper-scissors, which turns it back on itself)
      q.cam?.turnOff?.();
    }
    return leavingActive;
  }

  async function go(next, params = {}, { push = true } = {}) {
    // Kid mode: Settings (which can switch it off and connect other brains) is for the parent. Ask for the PIN first.
    if ((next === 'settings' || next === 'voice') && q.profile.kid && q.pin.has()) {
      const ok = await q.pin.ask({ mode: 'verify', title: 'Parent PIN', sub: 'Settings are locked while Kid mode is on.' });
      if (!ok) {
        if (location.hash === '#/settings' || location.hash === '#/voice') history.replaceState({ page, id: gameId }, '', page === 'game' ? `#/game/${gameId}` : `#/${page}`);
        return;
      }
    }
    const my = ++navToken;
    const id = next === 'game' ? params.id : '';
    if (next === 'game' && !GAMES[id]) next = 'home';
    teardown(next);
    page = next;
    gameId = id;
    app.dataset.page = page;
    q.page = page;
    if (push) {
      const hash = next === 'game' ? `#/game/${id}` : `#/${next}`;
      if (location.hash !== hash) history.pushState({ page: next, id }, '', hash);
    }
    q.idle.poke();

    if (next === 'quark') {
      q.hint(q.state.asleep ? `tap to wake ${q.name()}` : null);
      if (q.state.asleep) q.reactions.wake(q.state.firstBoot ? 'first' : 'gentle');
    } else if (next === 'game') {
      q.hint(null);
      if (q.state.asleep) await q.reactions.wake('quiet');
      if (my !== navToken) return;
      const mod = await GAMES[id]();
      if (my !== navToken) return;
      app.dataset.game = id;
      inst = mod.mount(q, gameLayer, { exit: () => go('home'), restart: () => go('game', { id }, { push: false }) });
      q.game = inst;
    } else {
      delete app.dataset.game;
      q.hint(null);
      dom.onPage?.(next);
    }
    if (next !== 'game') delete app.dataset.game;
    dom.onPage?.(next);
    // let the page scroll start at the top
    const el = document.getElementById(next);
    if (el && el.classList.contains('page')) el.scrollTop = 0;
  }

  window.addEventListener('popstate', () => {
    const r = parse(location.hash);
    go(r.page, { id: r.id }, { push: false });
  });

  // initial page from the URL (default: Home)
  const start = parse(location.hash);
  app.dataset.page = 'home';
  q.page = 'home';
  if (start.page !== 'home') {
    // deep links to the robot or a game still need a tap first for sound, but the page itself can open now
    go(start.page, { id: start.id }, { push: false });
  } else {
    dom.onPage?.('home');
  }
  return q.router;
}
