// Quark — entry point. (Stage 1: boots straight onto the Quark page; the Home grid arrives in stage 5.)

import { CONFIG } from './js/config.js';
import { createQuark } from './js/quark.js';
import { mountLab } from './js/dev.js';

const $ = (id) => document.getElementById(id);

const quark = createQuark({
  world: $('world'),
  faceMount: $('faceMount'),
  fxLayer: $('fxLayer'),
  stage: $('stage'),
  subtitles: $('subtitles'),
  hint: $('hint'),
  soundBtn: $('soundBtn'),
  app: $('app'),
  micBtn: $('micBtn'),
  kbBtn: $('kbBtn'),
  wakeBtn: $('wakeBtn'),
  typeBar: $('typeBar'),
  typeInput: $('typeInput'),
  eyeBtn: $('eyeBtn'),
  camPill: $('camPill'),
  camLabel: $('camLabel'),
  eyesOffBtn: $('eyesOffBtn'),
  consent: $('consent'),
  consentTitle: $('consentTitle'),
  consentYes: $('consentYes'),
  consentNo: $('consentNo'),
  home: $('home'),
  settingsEl: $('settings'),
  voiceEl: $('voice'),
  gameLayer: $('gameLayer'),
  homeBtn: $('homeBtn'),
});

if (CONFIG.showLab || new URLSearchParams(location.search).has('lab')) {  // the lab is hidden unless you open the page with ?lab
  mountLab(quark, { panel: $('dev'), button: $('labBtn') });
}

window.quark = quark; // handy from the console: quark.say('hi'), quark.face.express('angry', {ms: 2000})
