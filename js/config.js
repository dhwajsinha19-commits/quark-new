// One place for every tunable number and endpoint.

export const CONFIG = {
  build: 'build 5 · real conversation',
  defaultName: 'Quark',

  // --- AI brain (stage 2) -------------------------------------------------
  // The front end never holds an API key. It only POSTs the user's message, a short chat
  // history and text hints to *your* backend, which owns the key, rate limits and personality.
  backendUrl: '',                 // <- you will add this, e.g. 'https://quark-brain.example.com'
  geminiModel: 'auto',            // <- the one place the model name lives. "auto" = the server picks the newest Flash model your key can use;
                                  //    or name one (it must be in the server's ALLOWED_MODELS)
  chat: {
    timeoutMs: 40000,             // give up when the brain has sent nothing at all for this long (a free-tier model can take 15+ s)
    historyTurns: 15,             // how many recent turns are sent along as context (10 to 15)
    hintMaxAgeMs: 25000,          // movement hints older than this are dropped
  },

  // --- idle life ------------------------------------------------------------
  // Time since the last touch before Quark gets bored, sleepy, and finally falls asleep.
  idle: { boredMs: 30000, sleepyMs: 55000, sleepMs: 80000 },

  // --- touch ------------------------------------------------------------------
  touch: {
    punchMaxMs: 150,      // a tap shorter than this is a light punch
    petMinMs: 500,        // hold (or move slowly) this long to pet
    punchMaxMove: 24,     // px; a "tap" that travelled further than this isn't a punch
    petMaxSpeed: 0.5,     // px per ms; faster than this isn't petting
  },

  // the dev lab panel (force expressions, simulate camera events...). Off by default; open the page with ?lab to get it.
  showLab: false,
};
