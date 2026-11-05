"""Appends Lizard's engine/*.py to solver.zip, which solver/scripts/build_bundle.py has just written, so the worker's
Python can import them from /app beside gto/. Deterministic as that script is (sorted names, fixed timestamps), and
run before scripts/build-solver-assets.mjs hashes the bundle, so a change in engine/ is a new version.

    python scripts/pyodide/bundle_engine.py SOLVER.zip [ENGINE_DIR]      # prints the zip's sha1
"""
from __future__ import annotations

import glob
import hashlib
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def append(path: str, engine: str) -> str:
    """Adds engine/*.py to the zip at path; returns its sha1."""
    if not os.path.exists(path):
        raise SystemExit(f"{path}: build_bundle.py hasn't written it")
    sources = sorted(glob.glob(os.path.join(engine, "*.py")))
    if not any(os.path.basename(p) == "__init__.py" for p in sources):
        raise SystemExit(f"{engine} has no __init__.py: nothing could import it")
    with zipfile.ZipFile(path, "a", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for src in sources:
            info = zipfile.ZipInfo(f"engine/{os.path.basename(src)}", date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(src, "rb") as f:
                z.writestr(info, f.read(), compresslevel=9)
    with open(path, "rb") as f:
        return hashlib.sha1(f.read()).hexdigest()


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    print(append(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else os.path.join(ROOT, "engine")))
