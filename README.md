# Quark

A mobile-first robot pet that lives on your phone screen. Plain HTML, CSS and ES modules; no build step.

```bash
python3 serve.py              # http://localhost:5301
python3 serve.py --https      # self-signed HTTPS on your Wi-Fi, to try the camera and mic on a phone
python3 serve.py --set-key    # connect Gemini (see below)
```

`localhost` counts as a secure context, so camera and mic work on this computer over plain http. A phone needs HTTPS
(use `--https` and accept the certificate warning once, or put it behind a real HTTPS host). Add `?lab` to the URL for a
developer panel that forces expressions and simulates camera events.

## Making Quark talk about anything

Every message goes to a real AI brain. There is no canned conversation: with no brain connected Quark says so
(a notice, not a fake chat) and waits. It uses the first of these it finds:

1. **Gemini** (best). Get a free key at https://aistudio.google.com/apikey, then run `python3 serve.py --set-key` and
   paste it (input is hidden). It is saved in `.env`, which is never served. Restart `python3 serve.py` and the app finds
   its brain by itself at `/brain`. The key never goes in the browser, the app code, or a chat. To use your own deployed
   backend instead, see `backend/README.md` and put its URL in `js/config.js` (`backendUrl`) or Settings.
2. **On-device AI** (no key). In recent desktop Chrome: Settings > Brain > "Download & turn on". Free, private, a one-time
   download of a couple of GB. A small model, so it is chatty rather than encyclopedic.

What each message carries to the brain: the last 10 to 15 turns, a rolling memory summary, Quark's current emotion and
intensity, the time of day, how long you were quiet, and short event hints ("user waved"). The brain answers with JSON
`{ emotion, intensity, gesture, reply, memory_update }`, streamed: the face reacts first, Quark starts speaking on the
first sentence while the rest is still arriving, and the memory update is applied at the end.

**Modes** (Settings > Who is Quark for?): *Adult companion* (with an optional quiet *Focus buddy*), and *Kid friend and
teacher* (simple words, quizzes, family-safe, its own minimal memory, no camera hints sent). Kid mode is switched off, and
Settings opened, only with the parent PIN (stored as a salted hash in this browser; a lock for a child, not a vault).

Tasks (reminders, searches, texting...) are declined in character, freshly each time: Quark is a pet, not a tool.

## Voice, microphone and roast battle

- **Natural voice.** With the Gemini brain connected, Quark speaks through Gemini text-to-speech (`/brain/tts`), sentence by
  sentence, with a light small-robot sound on top and its mouth following the audio. Strongly emotional lines (sad, angry,
  sleepy...) use the style-aware speech model; everyday lines use the fast one. Spoken lines are cached on disk
  (`.quark-tts-cache/`), so repeats are instant and cost no quota. When the natural voice is chosen and busy, Quark babbles in
  chirps with subtitles; the browser's own voice is only used if you pick "Robot" in Settings (or there is no backend).
- **Microphone.** Tap the mic for one sentence. Hands-free ("Hey <name>") needs the wake phrase, except for 30 seconds after
  Quark has spoken, when it is just a conversation. Network hiccups and refused starts are retried instead of giving up.
- **Roast battle.** Chill / Spicy / Savage (Savage is adults-only and has to be switched on; Kid mode is always Chill). Quark's
  roasts come from a dedicated writer, the microphone stays open until you pause or say "done", and a blind judge scores both
  roasts on wit, specificity, originality and delivery. Off-limits targets (looks, family, religion, health, money, your name
  and where it comes from...) are blocked three ways: the prompt, a server filter, and a client filter.
- **Free-tier limits.** The free Gemini tier has a small daily quota per model. The server remembers which models are out of
  quota, busy or slow (`.quark-models.json`) and tries ones that answered recently first. Turning on billing for the key's
  project in Google AI Studio removes the waiting.

## Talking and seeing

- Tap the **mic** and talk, open the **keyboard** and type, or turn on **hands-free** and say "Hey Quark" (or the name you
  gave it). Voice input needs Chrome, Edge or Safari; typing works everywhere.
- The camera is off until you tap the eye button and agree. Video is processed on the device by MediaPipe (`vendor/mediapipe`),
  never uploaded or saved, and the camera turns off when you leave the Quark page or hide the tab.

## Games

Home has four games. Quark's moves, hands and banter all happen on screen, and you can start them by voice
("let's play chess").

| Game | Notes |
| --- | --- |
| Tap Challenge | 10 seconds, live counter, saved high score |
| Rock Paper Scissors | best of 3 or 5; tap, say it, or show your hand to the camera |
| Chess | chess.js rules, Stockfish at a casual level; tap, say or type moves ("e4", "knight to f3") |
| Roast Battle | 3 rounds, scored out of 10 by Quark, always ends on a compliment |

When Quark wins it dances. When it loses it throws a tantrum, a giant hand smacks the screen into a crack, the screen
takes 5 to 10 seconds to reform, and then it laughs and congratulates you. Gemini only writes banter and judges roasts;
it never picks chess moves.

## Layout

```
index.html, style.css, app.js
js/router.js, home.js                 pages: Home, Quark, games, Settings
js/face.js, expressions.js            the SVG face rig (springs, expressions, particles)
js/idle.js, mood.js                   blinking, sleepiness, moods
js/touch.js, reactions.js             pet / boop / punch, crack, sulk
js/endings.js, handsvg.js             win dance, lose tantrum, the glowing digital hand
js/voice.js, audio.js                 speech + chirps, synthesised sounds
js/chat.js, chat-ui.js, listen.js     conversation, microphone, wake phrase, typing bar
js/brain.js, ondevice.js, streamjson.js    streaming brain client (Gemini via /brain, or Chrome's on-device AI)
js/emotion.js, variety.js, quark-gestures.js, pin.js, memory.js   emotions, no-repeat guard, brain-chosen gestures, parent PIN, memory
js/games/                             tap, rps, roast (+roastlib), chess (+engine, parser, pieces)
js/vision/, vision-reactions.js       camera, MediaPipe, gestures, what Quark does with them
backend/server.py                     Gemini proxy: key, rate limits, personality prompt, roast judge
serve.py                              dev server + /brain + private-file protection + --set-key
vendor/                               MediaPipe, chess.js, Stockfish (all run locally)
```

## Third-party code (all in `vendor/`, all run in your browser)

- MediaPipe Tasks Vision: Apache-2.0
- chess.js: BSD-2-Clause
- Stockfish.js 10 (Stockfish): **GPL-3.0**. If you distribute this app, its license terms apply (see `vendor/stockfish/COPYING.txt`).


## Voice lab (the robot-pet voice, before it goes into the app)

Open `http://localhost:5301/voice-lab.html`, tap **Tap to wake Quark**, and tune it with the sliders.

* **Pet voice** (default): one soft continuous voice that glides along the sentence like a very small talking toy, with vowel shapes, puffs of air, hums and a light robot touch. **Chirps** is the first version (one beep per letter), kept so you can compare.
* `js/robotvoice.js` is the synth (`robotSpeak`, `speakQueue`, `stop`, `effects.*`, `backchannel`), `js/voiceplan.js` turns text into the voice's pitch / vowel / loudness curves. Every setting lives in `VOICE_CONFIG` (and `MOOD_TABLE` for the 11 moods).
* Checks: `tests/voice-offline.html?style=voice` and `?style=chirp` render the voice offline and measure it; `tests/voice-spectro.html` draws spectrograms.


## Sharing Quark with friends (everyone uses their own Gemini key)

A copy on GitHub Pages has no server, so it cannot hold *your* key. Instead each person pastes their own free key:

1. Open the app, then **Settings > Brain > Your own Gemini key**.
2. Get a free key at <https://aistudio.google.com/apikey> (sign in with Google, "Create API key"), paste it, press **Save & test**.

The key stays in that person's browser and goes only to Google (`js/geminikey.js`). Nothing passes through you, and it never spends your quota.

* `js/persona.js` is Quark's personality, generated from `backend/server.py` so the two cannot drift: run `python3 tools/gen_persona.py` after changing the personality (`python3 tests/test_persona_sync.py` checks it).
* Roast Battle still needs the full server brain (`python3 serve.py` with a key on your own computer); in key mode it uses its stock lines.
* Tests: `node tests/geminikey.mjs`, `node tests/temper.mjs`, `node tests/wake.mjs`, `node tests/listener.mjs`, `python3 tests/test_backend.py`.
