// The frame every game sits in: a header with Back, the title and a score, and a body area under Quark's face.

const backSvg = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';

export function gameShell(layer, { title, onBack }) {
  layer.innerHTML = `
    <div class="game-shell">
      <header class="game-head">
        <button class="game-back" type="button" aria-label="Back to Home">${backSvg}</button>
        <h2></h2>
        <div class="game-score" aria-live="polite"></div>
      </header>
      <div class="game-body"></div>
    </div>`;
  layer.querySelector('h2').textContent = title;
  layer.querySelector('.game-back').addEventListener('click', onBack);
  const score = layer.querySelector('.game-score');
  const body = layer.querySelector('.game-body');
  return {
    root: layer.firstElementChild,
    body,
    setScore(text) { score.textContent = text; },
    clear() { body.textContent = ''; },
    /** Replace the body with HTML and return it. */
    html(markup) { body.innerHTML = markup; return body; },
  };
}

/** Small DOM helper: el('div', 'class', 'text or html') */
export function el(tag, cls = '', html = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
