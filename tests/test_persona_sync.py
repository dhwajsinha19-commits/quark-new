#!/usr/bin/env python3
"""js/persona.js (the browser's copy of Quark's personality) must match backend/server.py. Run: python3 tests/test_persona_sync.py"""
import os
import subprocess
import sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
r = subprocess.run([sys.executable, os.path.join(root, "tools", "gen_persona.py"), "--check"], capture_output=True, text=True)
print(r.stdout.strip() or r.stderr.strip())
sys.exit(r.returncode)
