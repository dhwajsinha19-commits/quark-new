"""Backend logic that needs no network: model racing, benching, ranking, the roast safety net. Run: python3 tests/test_backend.py"""
import importlib.util, io, json, os, sys, time, urllib.error, urllib.request

os.environ["MOCK"] = ""
spec = importlib.util.spec_from_file_location("b", os.path.join(os.path.dirname(__file__), "..", "backend", "server.py"))
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
b.STATE_PATH = "/tmp/quark-test-state.json"
ok = bad = 0
def check(c, n, extra=""):
    global ok, bad
    if c: ok += 1
    else: bad += 1; print("FAIL", n, extra)

class R(io.BytesIO):
    closed_flag = False
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def close(self): R.closed_flag = True; super().close()
def http(code, body=""): return urllib.error.HTTPError("u", code, "x", {}, io.BytesIO(body.encode()))

RANKED = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
def fresh():
    b.API_KEY = "K" * 40; b._cool.clear(); b._cool_kind.clear(); b._good.clear(); b._no_think.clear()
    b.remember_model(b.API_KEY, RANKED[0], RANKED); b._tl.trace = []; b._tl.model = ""; R.closed_flag = False
    b.HEDGE_AFTER = 0.3

def behaviour(table):
    """table: model -> ('ok', seconds) | ('hang', seconds) | ('http', code)"""
    def op(req, timeout=None, context=None):
        m = req.full_url.split("/models/")[-1].split(":")[0]
        kind, v = table.get(m, ("http", 404))
        if kind == "ok": time.sleep(v); return R(b"{}")
        if kind == "hang": time.sleep(min(v, timeout)); raise TimeoutError("timed out")
        raise http(v, "{}")
    return op

real = urllib.request.urlopen
try:
    # 1. the newest models hang; a lite model answers: the answer comes from the race, not after waiting out the hangs
    fresh(); urllib.request.urlopen = behaviour({"gemini-3.8-flash": ("hang", 5), "gemini-3.7-flash": ("hang", 5), "gemini-3.5-flash-lite": ("ok", 0.2), "gemini-3.6-flash": ("ok", 3)})
    t = time.time(); resp = b._open_gemini(RANKED[0], [], "s", {}, 100, True, None, 12)
    check(b._tl.model == "gemini-3.5-flash-lite" and time.time() - t < 1.5, "a lite model wins the race against hanging models", f"{b._tl.model} {time.time()-t:.2f}s")
    # 2. the best model answers quickly: nobody else is even needed
    fresh(); urllib.request.urlopen = behaviour({"gemini-3.8-flash": ("ok", 0.1)})
    t = time.time(); b._open_gemini(RANKED[0], [], "s", {}, 100, True, None, 12)
    check(b._tl.model == "gemini-3.8-flash" and time.time() - t < 0.25, "a healthy best model answers on its own", f"{b._tl.model}")
    # 3. a model that fails fast hands over immediately (no waiting out the stagger)
    fresh(); b.HEDGE_AFTER = 5; urllib.request.urlopen = behaviour({"gemini-3.8-flash": ("http", 503), "gemini-3.5-flash-lite": ("ok", 0.05)})
    t = time.time(); b._open_gemini(RANKED[0], [], "s", {}, 100, True, None, 12)
    check(b._tl.model == "gemini-3.5-flash-lite" and time.time() - t < 1, "a 503 hands over at once", f"{time.time()-t:.2f}s")
    check("gemini-3.8-flash" in b._cool, "the overloaded model is benched")
    # 4. everything fails: an error, not a hang
    fresh(); urllib.request.urlopen = behaviour({})
    try: b._open_gemini(RANKED[0], [], "s", {}, 100, True, None, 12); check(False, "all fail raises")
    except RuntimeError as e: check(True, "all fail raises")
    # 5. the loser is closed when the winner is a slower one that started first
    fresh(); urllib.request.urlopen = behaviour({"gemini-3.8-flash": ("ok", 0.6), "gemini-3.5-flash-lite": ("ok", 0.1)})
    b._open_gemini(RANKED[0], [], "s", {}, 100, True, None, 12); time.sleep(0.8)
    check(b._tl.model == "gemini-3.5-flash-lite" and R.closed_flag, "the slower late response is closed, not leaked", f"{b._tl.model} {R.closed_flag}")
    # 6. proven fast models go first next time
    fresh(); b._good["gemini-3.1-flash-lite"] = (time.time() - 30, 1.1)
    check(b._usable(RANKED)[0] == "gemini-3.1-flash-lite", "a model that answered recently is tried first")
    # 7. the trace records every attempt
    fresh(); urllib.request.urlopen = behaviour({"gemini-3.8-flash": ("hang", 5), "gemini-3.5-flash-lite": ("ok", 0.1)})
    b._open_gemini(RANKED[0], [], "s", {}, 100, True, None, 12); time.sleep(0.2)
    outs = {x["model"]: x["outcome"] for x in b._tl.trace}
    check(outs.get("gemini-3.5-flash-lite") == "ok", "trace has the winner", str(outs))
finally:
    urllib.request.urlopen = real
    if os.path.exists(b.STATE_PATH): os.remove(b.STATE_PATH)

# safety net for roasts
for t in ["Your mom is so slow", "You're so fat that", "your face looks like", "that's so gay", "poor guy can't afford a charger"]:
    check(not b.roast_ok(t), "blocked: " + t)
for t in ["You answer questions like a loading screen with commitment issues.", "I'm a robot who lives in a phone and even I think you take too long to type."]:
    check(b.roast_ok(t), "allowed: " + t)
# a bare number from the microphone: the model is told it may be a mis-heard word ("fought" heard as "14")
_, cc = b.build_contents({"message": "14", "heard": {"confidence": 0.7, "alternatives": ["fought", "fort", "fourth", "fifth"], "numeric": True}})
_txt = json.dumps(cc)
check("only a number" in _txt and "fought" in _txt and "fourth" in _txt and "fifth" not in _txt, "numeric transcript is flagged, three alternatives are forwarded", _txt[-300:])
_, cc = b.build_contents({"message": "14", "heard": {"confidence": 0.9, "alternatives": []}})
check("only a number" not in json.dumps(cc), "an unflagged transcript gets no number note")
print(f"{ok} passed, {bad} failed"); sys.exit(1 if bad else 0)
