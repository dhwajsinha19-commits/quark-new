// Subtitles are always on. Quark's words light up as it says them, karaoke style; the user's own words
// (from the mic or keyboard) appear in a small line above; non-speech sounds get a tiny italic caption.
//
// A line can arrive all at once (show) or grow while Quark is still being written (begin, then append).

export function createSubtitles(root) {
  const heardEl = document.createElement('div');
  heardEl.className = 'heard';
  const sfx = document.createElement('div');
  sfx.className = 'sfx';
  const line = document.createElement('div');
  line.className = 'line';
  root.append(heardEl, sfx, line);

  let words = [];
  let said = 0;
  let hideTimer = 0;
  let sfxTimer = 0;
  let heardTimer = 0;

  /** Start an empty line; words are added with append(). */
  function begin() {
    clearTimeout(hideTimer);
    root.classList.remove('notice');
    line.textContent = '';
    words = [];
    said = 0;
    root.classList.add('on');
  }

  /** Add more words to the end of the current line. */
  function append(text) {
    clearTimeout(hideTimer);
    for (const w of text.split(/\s+/).filter(Boolean)) {
      const s = document.createElement('span');
      s.className = 'w';
      s.textContent = w;
      if (words.length < said) s.classList.add('said');
      line.append(s, ' ');
      words.push(s);
    }
    root.classList.add('on');
  }

  function show(text) {
    begin();
    append(text);
  }

  /** A plain notice from the app itself (not Quark talking): amber italic, lit up at once, gone after `ms`. */
  function notice(text, ms = 6000) {
    show(text);
    progress(words.length);
    root.classList.add('notice');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { root.classList.remove('on', 'notice'); }, ms);
  }

  /** Light up the first n words. */
  function progress(n) {
    said = Math.max(said, n);
    for (let i = 0; i < Math.min(n, words.length); i++) words[i].classList.add('said');
  }

  /** Line is done being spoken: light everything up, then fade out after a reading pause. */
  function finish() {
    progress(words.length);
    const chars = words.reduce((n, w) => n + w.textContent.length + 1, 0);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => root.classList.remove('on'), 1100 + chars * 22);
  }

  function hide() {
    clearTimeout(hideTimer);
    root.classList.remove('on');
  }

  /** What the user said. interim = still being spoken (shown dimmer, replaced as it grows). */
  function heard(text, { interim = false } = {}) {
    clearTimeout(heardTimer);
    heardEl.textContent = text ? `“${text}”` : '';
    heardEl.classList.toggle('interim', interim);
    heardEl.classList.toggle('on', !!text);
    if (text && !interim) heardTimer = setTimeout(() => heardEl.classList.remove('on'), 4200);
  }

  /** Small italic caption for non-speech sounds: *purr*, *yawn*… */
  function caption(text, ms = 1600) {
    clearTimeout(sfxTimer);
    sfx.textContent = text;
    sfx.classList.add('on');
    sfxTimer = setTimeout(() => sfx.classList.remove('on'), ms);
  }

  return { show, begin, append, notice, progress, finish, hide, heard, caption, get wordCount() { return words.length; } };
}
