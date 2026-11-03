# Quark's brain (backend)

A tiny server that sits between the Quark web app and Google Gemini. It holds the API key, the
rate limits, and Quark's personality and safety prompt, so none of those ever ship in the web app.

## Run it

```bash
# real Gemini (free-tier key from https://aistudio.google.com/apikey)
GEMINI_API_KEY=your-key python3 backend/server.py

# or test the wiring with no key
MOCK=1 python3 backend/server.py
```

It listens on `http://localhost:8787`. Point the app at it either by setting `backendUrl` in
`js/config.js`, or from the in-app lab panel (it saves the URL in the browser).

## The contract

`POST /chat` with JSON:

```json
{
  "model": "gemini-2.5-flash",
  "message": "hey, what's up?",
  "history": [{"role": "user", "text": "hi"}, {"role": "quark", "text": "Hi hi hi!"}],
  "hints": ["user waved"],
  "context": {"robotName": "Quark", "userName": "Sam", "topics": ["your exam"]}
}
```

Reply:

```json
{ "reply": "Hey Sam! Not much, just blinking professionally.", "mood": "playful", "userName": "", "topic": "" }
```

`mood` is one of `happy, excited, playful, curious, sleepy, bored, sulky, sad, loving, startled`.
Status `429` means the visitor hit a rate limit; `502` means Gemini was unreachable. In both cases the
app falls back to its built-in brain, so Quark never goes silent.

## Why it works this way

- **Model name** lives in one place in the app (`geminiModel` in `js/config.js`), default `"auto"`: the server asks
  Google which models your key can use and picks the newest Flash (so a retired model name can't break chat). A name
  sent by the app is only honoured if it is in `ALLOWED_MODELS`, so a visitor can't pick an expensive model.
- **No frames or landmarks** ever reach this server, only the short text hints the app chooses to send.
- **Rate limits**: 12 requests/minute and 300/day per visitor, 60/minute overall (all adjustable by env var).
- **Nothing is logged** about what people say.

## Deploying

Any host that runs Python 3 works (a small VM, Render, Fly.io, Railway). Put it behind HTTPS (the web app
needs HTTPS for the camera and microphone, and browsers block an https page from calling plain http).
Set `ALLOWED_ORIGINS` to your site's origin, `TRUST_PROXY=1` if it sits behind a proxy, and keep
`GEMINI_API_KEY` in the host's secret settings.
