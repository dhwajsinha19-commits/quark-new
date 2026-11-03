#!/usr/bin/env python3
"""Quark's dev server: serves the app AND hosts Quark's brain, so there is nothing to configure.

  python3 serve.py              -> http://localhost:5301
  python3 serve.py 8080         -> custom port
  python3 serve.py --https      -> self-signed HTTPS on your Wi-Fi, for trying camera/mic on a phone
  http://localhost:5301/setup   -> a page to paste your Gemini API key into (saved to a private .env file)
  python3 serve.py --set-key    -> or paste it in the terminal (hidden)
  python3 serve.py --check-key  -> test the saved key

Giving Quark its big brain (so it can talk about anything):
  1. Get a free key at https://aistudio.google.com/apikey
  2. python3 serve.py --set-key        (the key never goes in chat, code, or the browser)
  3. python3 serve.py                   (the app finds the brain by itself at /brain)

The key lives only in `.env` on this machine; this server never serves dotfiles, the backend/ folder or any .py file.
localhost counts as a secure context, so camera and mic work on this computer over plain http; a phone needs --https.
"""
import getpass
import http.server
import importlib.util
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

args = [a for a in sys.argv[1:] if not a.startswith("--")]
PORT = int(args[0]) if args else 5301
USE_HTTPS = "--https" in sys.argv
VERBOSE = "--verbose" in sys.argv

# a dev server shared by one person can allow more chatting per minute than a public one
os.environ.setdefault("RATE_PER_MIN", "40")
os.environ.setdefault("GLOBAL_PER_MIN", "120")


def load_brain():
    spec = importlib.util.spec_from_file_location("quark_brain", os.path.join(ROOT, "backend", "server.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


BRAIN = load_brain()


SETUP_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Quark's brain</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 18px; background: #03050a; color: #eaffff; font: 16px/1.45 ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: min(100%, 460px); padding: 24px 22px; border-radius: 26px; background: #0b1424; border: 1px solid rgba(82,232,255,.35); box-shadow: 0 0 44px rgba(82,232,255,.14), 0 20px 50px rgba(0,0,0,.6); }
  h1 { margin: 0 0 6px; font-size: 22px; }
  p { margin: 0 0 14px; color: rgba(255,255,255,.7); font-size: 14.5px; }
  .step { margin: 18px 0 8px; font-size: 12.5px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: rgba(82,232,255,.85); }
  a.btn, button { display: inline-block; padding: 12px 18px; border-radius: 999px; border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.08); color: #eaffff; font: inherit; font-weight: 650; text-decoration: none; cursor: pointer; }
  button.primary { background: #52e8ff; color: #03161c; border-color: transparent; box-shadow: 0 0 18px rgba(82,232,255,.45); }
  button:disabled { opacity: .5; cursor: default; }
  input { width: 100%; padding: 14px; margin-bottom: 10px; border-radius: 14px; border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.06); color: #eaffff; font: inherit; outline: none; }
  input:focus { border-color: #52e8ff; box-shadow: 0 0 0 3px rgba(82,232,255,.16); }
  #msg { min-height: 24px; margin-top: 12px; font-weight: 650; }
  #msg.ok { color: #7affc8; } #msg.bad { color: #ff9a7a; }
  small { display: block; margin-top: 16px; color: rgba(255,255,255,.5); font-size: 12.5px; }
</style></head>
<body><main>
  <h1>Connect Quark's brain</h1>
  <p>Quark chats through Google's Gemini. It needs a free key from your Google account.</p>
  <div class="step">1 · Get a key</div>
  <a class="btn" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Open Google AI Studio</a>
  <p style="margin-top:10px">Click “Create API key”, then the copy icon next to it.</p>
  <div class="step">2 · Paste it here</div>
  <form id="f" autocomplete="off">
    <input id="k" type="password" name="quark-key-field" placeholder="Paste your key" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" required>
    <button class="primary" id="go" type="submit">Save and test</button>
  </form>
  <div id="msg" role="status" aria-live="polite"></div>
  <small>The key goes straight from this box to a private file on your computer. It isn't kept in the browser, and the only place it is sent is Google, to check that it works. This page only opens on the computer running Quark.</small>
</main>
<script>
  const f = document.getElementById('f'), k = document.getElementById('k'), go = document.getElementById('go'), msg = document.getElementById('msg');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = k.value.trim();
    if (!key) return;
    go.disabled = true; msg.className = ''; msg.textContent = 'Checking the key with Google…';
    try {
      const r = await fetch('/brain/set-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
      const j = await r.json();
      if (j.ok) {
        k.value = ''; f.hidden = true;
        msg.className = 'ok';
        msg.textContent = j.model ? 'Connected! Quark is using ' + j.model + '.' : 'Key saved! ' + (j.note || '');
        const back = document.createElement('a'); back.className = 'btn'; back.href = '/'; back.textContent = 'Back to Quark';
        msg.append(document.createElement('br'), document.createElement('br'), back);
      } else { msg.className = 'bad'; msg.textContent = j.error || 'That did not work.'; go.disabled = false; }
    } catch (err) { msg.className = 'bad'; msg.textContent = 'Could not reach the Quark server. Is it still running?'; go.disabled = false; }
  });
</script></body></html>"""

LOOPBACK = ("127.0.0.1", "::1", "::ffff:127.0.0.1")
KEY_RE = re.compile(r"^[A-Za-z0-9._\-]{20,300}$")


def write_key(key):
    """Save the key to the private .env (replacing any old one) and use it right away, without a restart."""
    path = os.path.join(ROOT, ".env")
    lines = []
    try:
        with open(path, encoding="utf-8") as f:
            lines = [ln.rstrip("\n") for ln in f if not ln.startswith("GEMINI_API_KEY=")]
    except OSError:
        pass
    lines.append(f"GEMINI_API_KEY={key}")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    os.chmod(path, 0o600)
    BRAIN.API_KEY = key
    os.environ["GEMINI_API_KEY"] = key
    return path


def probe_key(key):
    """Check a key with Google: list the models it can use, then ask the best ones a tiny question until one answers.
    Returns (state, message, model): state True = the key is valid (save it), False = refuse it, None = couldn't check.
    `model` is the one that answered, or None if every model was busy (the key is still valid). Messages never contain the key."""
    ctx = BRAIN.SSL_CTX
    names = None
    for attempt in range(2):                       # one quiet retry: a single dropped connection isn't "no internet"
        try:
            names = BRAIN.list_models(key)
            break
        except urllib.error.HTTPError as e:
            if e.code == 429:
                names = []
                break
            if e.code in (400, 401, 403):
                return False, "Google says this key isn't valid. Check you copied the whole key and try again.", None
            if e.code < 500 or attempt == 1:
                return False, "Google answered with an error (%d). Try again in a moment." % e.code, None
        except Exception as e:  # noqa: BLE001
            print("key check: listing models failed (%s)" % type(e).__name__, flush=True)
            if attempt == 1:
                return None, "Could not reach Google to check the key. Check your internet and try again.", None
        time.sleep(1)
    ranked = BRAIN.ranked_models(names)
    body = {"contents": [{"role": "user", "parts": [{"text": "Say hi in two words."}]}], "generationConfig": {"maxOutputTokens": 24}}
    busy = []
    for model in ranked[:3]:
        url = "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent" % model
        req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={"Content-Type": "application/json", "x-goog-api-key": key})
        try:
            with urllib.request.urlopen(req, timeout=12, context=ctx) as r:
                json.load(r)
            BRAIN.remember_model(key, model, ranked)
            return True, "ok", model
        except urllib.error.HTTPError as e:
            if e.code in BRAIN.RETRY_NEXT:
                busy.append(model)                  # overloaded, over the free limit, or not offered to this key: try the next one
                continue
            try:
                why = json.loads(e.read().decode("utf-8", "replace")).get("error", {}).get("message", "")
            except ValueError:
                why = ""
            return False, ("The key is valid, but Google would not let it use %s (error %d)%s" % (model, e.code, (": " + why[:140]) if why else ".")), None
        except Exception as e:  # noqa: BLE001
            # a timeout or dropped connection on one busy model: the listing just worked, so go on to the next model
            print("key check: %s did not answer (%s)" % (model, type(e).__name__), flush=True)
            busy.append(model)
            continue
    BRAIN.remember_model(key, ranked[0], ranked)
    return True, "Google's models are busy right now, so chat wasn't tested yet. The key is valid and saved; Quark tries the models in turn when you talk.", None


def blocked(path):
    """Never serve secrets or source: dotfiles (.env, .certs), backend/, python files."""
    parts = [p for p in urllib.parse.unquote(path.split("?", 1)[0]).split("/") if p]
    return any(p.startswith(".") or p in ("backend", "__pycache__") or p.endswith((".py", ".pyc")) for p in parts)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
        ".task": "application/octet-stream",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *a):
        if VERBOSE:
            super().log_message(fmt, *a)

    def _json(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _route(self):
        return self.path.split("?", 1)[0]

    def _host(self):
        h = self.headers.get("Host", "")
        name = h[1:h.index("]")] if h.startswith("[") and "]" in h else h.split(":")[0]
        return h, name

    def _local_only(self, need_origin=False):
        """The key page is for this computer only: a loopback client, a localhost Host header (blocks DNS tricks),
        and for POSTs an Origin that is this very page (blocks other websites from posting to localhost)."""
        if self.client_address[0] not in LOOPBACK:
            return False
        host, name = self._host()
        if name not in ("localhost", "127.0.0.1", "::1"):
            return False
        if need_origin:
            if self.headers.get("Origin", "") not in (f"http://{host}", f"https://{host}"):
                return False
            if self.headers.get("Sec-Fetch-Site", "same-origin") != "same-origin":
                return False
        return True

    def do_GET(self):
        if self._route() == "/setup":
            if not self._local_only():
                raw = b"This page only opens on the computer that is running Quark: http://localhost:%d/setup" % PORT
                self.send_response(403)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
                return
            raw = SETUP_PAGE.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(raw)
            return
        if self._route() == "/brain/health":
            return self._json(200, {"ok": True, "mock": BRAIN.MOCK, "hasKey": bool(BRAIN.API_KEY), "models": BRAIN.ALLOWED_MODELS or [BRAIN._model["name"] or "auto"]})
        if blocked(self.path):
            return self.send_error(404)
        super().do_GET()

    def do_HEAD(self):
        if blocked(self.path):
            return self.send_error(404)
        super().do_HEAD()

    def do_POST(self):
        if self._route() == "/brain/set-key":
            return self._set_key()
        if self._route() == "/brain/tts":
            try:
                n = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(n)) if 0 < n <= 4000 else None
            except ValueError:
                payload = None
            if not isinstance(payload, dict):
                return self._json(400, {"error": "bad request"})
            code, raw, ctype = BRAIN.handle_tts(payload, self.client_address[0])
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if self._route() != "/brain/chat":
            return self._json(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            n = 0
        if n <= 0 or n > 40000:
            return self._json(413 if n > 40000 else 400, {"error": "bad size"})
        try:
            payload = json.loads(self.rfile.read(n))
            if not isinstance(payload, dict):
                raise ValueError
        except ValueError:
            return self._json(400, {"error": "bad json"})
        if payload.get("stream") and payload.get("mode") != "judge":
            return BRAIN.stream_response(self, payload, self.client_address[0])   # server-sent events
        code, obj = BRAIN.handle(payload, self.client_address[0])
        self._json(code, obj)


def _set_key_impl(self):
    if not self._local_only(need_origin=True):
        return self._json(403, {"ok": False, "error": "The key page only works on the computer running Quark."})
    try:
        n = int(self.headers.get("Content-Length", "0"))
    except ValueError:
        n = 0
    if n <= 0 or n > 2000:
        return self._json(400, {"ok": False, "error": "That doesn't look like a key."})
    try:
        key = str(json.loads(self.rfile.read(n)).get("key", "")).strip()
    except (ValueError, AttributeError):
        return self._json(400, {"ok": False, "error": "That didn't work. Reload the page and try again."})
    if not KEY_RE.match(key):
        return self._json(200, {"ok": False, "error": "That doesn't look like a Gemini key (no spaces, about 40 letters and numbers). Copy it again from AI Studio."})
    state, message, model = probe_key(key)
    if state:
        write_key(key)
        print("Gemini key saved to .env from the setup page (model: %s)." % (model or "not tested, Google was busy"), flush=True)
        return self._json(200, {"ok": True, "model": model, "note": "" if model else message})
    return self._json(200, {"ok": False, "error": message})


Handler._set_key = _set_key_impl


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no packet is sent; just picks the outbound interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def make_cert(ip):
    d = os.path.join(ROOT, ".certs")
    os.makedirs(d, exist_ok=True)
    key, crt = os.path.join(d, "key.pem"), os.path.join(d, "cert.pem")
    if not (os.path.exists(key) and os.path.exists(crt)):
        subprocess.run(
            ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "365",
             "-keyout", key, "-out", crt, "-subj", "/CN=quark.local",
             "-addext", f"subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{ip}"],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return key, crt


class Server(http.server.ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def set_key():
    key = getpass.getpass("Paste your Gemini API key (input is hidden), then press Enter: ").strip()
    if not key:
        print("No key entered; nothing changed.")
        return
    path = write_key(key)
    print(f"Saved to {path} (readable only by you).")
    check_key()


def check_key():
    if not BRAIN.API_KEY:
        print("No GEMINI_API_KEY found. Run: python3 serve.py --set-key")
        return False
    try:
        data = BRAIN.call_gemini(BRAIN.discover_model(force=True), [{"role": "user", "parts": [{"text": "USER SAYS: hi"}]}])
        obj = BRAIN.validate(BRAIN.parse_gemini(data) or {})
        print("Key works. Quark says:", obj["reply"] or "(empty reply)", f"[{obj['emotion']} {obj['intensity']}]")
        return True
    except Exception as e:  # noqa: BLE001
        print("The key did not work:", str(e)[:300])
        return False


if __name__ == "__main__":
    if "--set-key" in sys.argv:
        set_key()
        sys.exit(0)
    if "--check-key" in sys.argv:
        sys.exit(0 if check_key() else 1)

    ip = lan_ip()
    httpd = Server(("0.0.0.0", PORT), Handler)
    scheme = "http"
    if USE_HTTPS:
        key, crt = make_cert(ip)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(crt, key)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        scheme = "https"
    brain = "Gemini ready" if BRAIN.API_KEY else ("MOCK replies" if BRAIN.MOCK else "NO BRAIN CONNECTED, so Quark cannot chat yet (open http://localhost:%d/setup to paste a Gemini key)" % PORT)
    print(f"Quark dev server\n  this machine : {scheme}://localhost:{PORT}/\n  on your Wi-Fi: {scheme}://{ip}:{PORT}/\n  brain        : {brain}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
