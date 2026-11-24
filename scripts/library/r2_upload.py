#!/usr/bin/env python3
"""Upload the library sets an assembled stage serves from R2 (its hosts.json, scripts/library/assemble.py
assign_hosts) to the Cloudflare R2 bucket, sending only what changed, resumable.

Each file of each R2 set goes to <prefix><set>/<file> in the bucket, where <prefix> is the path of the R2 base the
stage's hosts.json names (https://lib.example.com/lizard-library/ -> "lizard-library/"), so the public URL of a file is
that base plus its library path, as the web (web/src/library/hosts.ts) and the worker (scripts/pyodide/worker-edits.mjs)
ask for it. A manifest (default library-build/r2-manifest.json, outside git) keeps each uploaded key's size and sha1;
a file whose size and sha1 match is skipped, and the manifest is saved every 200 uploads and at the end, so a run that
stops resumes where it was. `--verify` asks the bucket for every key the manifest lists (HEAD) instead of trusting it.

Headers: Cache-Control "public, max-age=14400" on entries (.bin: the worker asks for them unversioned, so a rebuilt
entry is picked up within 4 hours; until then the engine refuses one that isn't its index's and solves live) and
"public, max-age=300" on JSON; Content-Type application/octet-stream or application/json. The bucket's CORS policy
(scripts/library/r2-cors.json, set once: docs/DEPLOYMENT.md) lets the site read it from the page and the worker.

Two ways to send: the S3-compatible API (default; standard library only, AWS Signature V4, four connections at once),
with R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET in the environment (an R2 API token's S3
credentials), or `--via wrangler` (`wrangler r2 object put --remote`, one process a file: slow, for a first test with
wrangler's own login). `--prune` deletes the keys under <prefix> the manifest lists that the stage no longer serves from
R2 (run it after the Pages push: until then the live index may still ask for them).

    r2_upload.py --stage library-build/stage [--manifest PATH] [--dry-run] [--verify] [--prune] [--via s3|wrangler]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "library-build" / "r2-manifest.json"
SET_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
BIN_CACHE = "public, max-age=14400"
JSON_CACHE = "public, max-age=300"
WORKERS = 4
SAVE_EVERY = 200
EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()


# ----------------------------------------------------------------------------- AWS Signature V4 (S3, R2's "auto" region)
def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def sign_v4(method: str, url: str, headers: dict, payload_sha256: str, access_key: str, secret: str,
            amz_date: str, region: str = "auto", service: str = "s3") -> str:
    """The Authorization header for this request. `headers` are the ones signed (lower-case names; host,
    x-amz-content-sha256 and x-amz-date among them); the path is used as given (already URI-encoded)."""
    u = urllib.parse.urlsplit(url)
    query = "&".join(f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(v, safe='-_.~')}"
                     for k, v in sorted(urllib.parse.parse_qsl(u.query, keep_blank_values=True)))
    names = sorted(h.lower() for h in headers)
    hv = {k.lower(): " ".join(str(v).strip().split()) for k, v in headers.items()}
    canonical = "\n".join([method, u.path or "/", query, "".join(f"{n}:{hv[n]}\n" for n in names), ";".join(names),
                           payload_sha256])
    date = amz_date[:8]
    scope = f"{date}/{region}/{service}/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    k = _hmac(_hmac(_hmac(_hmac(("AWS4" + secret).encode(), date), region), service), "aws4_request")
    sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    return f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, SignedHeaders={';'.join(names)}, Signature={sig}"


class S3:
    """R2's S3-compatible API, path style: https://<account>.r2.cloudflarestorage.com/<bucket>/<key>."""

    def __init__(self, account: str, bucket: str, access_key: str, secret: str):
        if not re.fullmatch(r"[0-9a-f]{32}", account):
            raise SystemExit("R2_ACCOUNT_ID should be the account's 32-hex-digit id")
        self.host = f"{account}.r2.cloudflarestorage.com"
        self.bucket, self.access_key, self.secret = bucket, access_key, secret

    def _req(self, method: str, key: str, body: bytes = b"", extra: dict | None = None):
        url = f"https://{self.host}/{self.bucket}/{urllib.parse.quote(key, safe='/-_.~')}"
        amz = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        h = hashlib.sha256(body).hexdigest() if body else EMPTY_SHA256
        signed = {"host": self.host, "x-amz-content-sha256": h, "x-amz-date": amz}
        auth = sign_v4(method, url, signed, h, self.access_key, self.secret, amz)
        req = urllib.request.Request(url, data=body if method == "PUT" else None, method=method,
                                     headers={**signed, **(extra or {}), "Authorization": auth})
        return urllib.request.urlopen(req, timeout=60)

    def put(self, key: str, body: bytes, content_type: str, cache: str) -> None:
        for attempt in range(4):
            try:
                with self._req("PUT", key, body, {"Content-Type": content_type, "Cache-Control": cache}) as r:
                    r.read()
                return
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt == 3 or (isinstance(e, urllib.error.HTTPError) and e.code in (400, 401, 403)):
                    raise

    def head(self, key: str) -> int | None:
        try:
            with self._req("HEAD", key) as r:
                return int(r.headers.get("Content-Length", -1))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise

    def delete(self, key: str) -> None:
        with self._req("DELETE", key) as r:
            r.read()


class Wrangler:
    """`wrangler r2 object put|delete <bucket>/<key> --remote`, wrangler's own login (slow: a process a file)."""

    def __init__(self, bucket: str, bin_: str):
        self.bucket, self.bin = bucket, bin_

    def put(self, key: str, body: bytes, content_type: str, cache: str, path: Path | None = None) -> None:
        subprocess.run([self.bin, "r2", "object", "put", f"{self.bucket}/{key}", "--file", str(path), "--remote",
                        "--content-type", content_type, "--cache-control", cache], check=True,
                       stdout=subprocess.DEVNULL)

    def head(self, key: str) -> int | None:
        raise SystemExit("--verify needs the S3 API (--via s3)")

    def delete(self, key: str) -> None:
        subprocess.run([self.bin, "r2", "object", "delete", f"{self.bucket}/{key}", "--remote"], check=True,
                       stdout=subprocess.DEVNULL)


# ----------------------------------------------------------------------------- what to send
def r2_plan(stage: Path) -> tuple[str, list[tuple[str, Path]]]:
    """(the key prefix, [(key, local file)]) for every file of every set the stage's hosts.json serves from R2."""
    hf = stage / "hosts.json"
    if not hf.exists():
        return "", []
    hosts = json.loads(hf.read_text())
    if hosts.get("format") != 1:
        raise SystemExit(f"{hf}: format {hosts.get('format')!r}, this script reads 1")
    bases = {v for k, v in hosts["sets"].items()}
    if len(bases) != 1 or "r2" not in hosts["hosts"] or bases != {"r2"}:
        raise SystemExit(f"{hf}: expected every set on the one host 'r2', got {sorted(bases)}")
    base = hosts["hosts"]["r2"]
    u = urllib.parse.urlsplit(base)
    if u.scheme != "https" or not base.endswith("/") or u.query or u.fragment:
        raise SystemExit(f"{hf}: the R2 base {base!r} isn't an https URL ending in /")
    prefix = u.path.lstrip("/")
    files = []
    for s in sorted(hosts["sets"]):
        if not SET_RE.match(s):
            raise SystemExit(f"{hf}: set id {s!r}")
        d = stage / s
        if not d.is_dir():
            raise SystemExit(f"{hf} names {s}, which the stage doesn't hold")
        for p in sorted(d.rglob("*")):
            if p.is_file():
                files.append((f"{prefix}{p.relative_to(stage).as_posix()}", p))
    return prefix, files


def headers_of(path: Path) -> tuple[str, str]:
    if path.suffix == ".json":
        return "application/json", JSON_CACHE
    return "application/octet-stream", BIN_CACHE


def load_manifest(path: Path) -> dict:
    try:
        m = json.loads(path.read_text())
        return m if isinstance(m, dict) and m.get("format") == 1 else {"format": 1, "keys": {}}
    except (OSError, ValueError):
        return {"format": 1, "keys": {}}


def save_manifest(path: Path, m: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(m, sort_keys=True, separators=(",", ":")))
    os.replace(tmp, path)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stage", required=True, type=Path)
    ap.add_argument("--manifest", type=Path, default=MANIFEST)
    ap.add_argument("--dry-run", action="store_true", help="say what would be sent; send nothing")
    ap.add_argument("--verify", action="store_true", help="HEAD every manifest key before trusting it")
    ap.add_argument("--prune", action="store_true", help="delete keys the stage no longer serves from R2")
    ap.add_argument("--via", choices=("s3", "wrangler"), default="s3")
    ap.add_argument("--wrangler", default=os.environ.get("WRANGLER", "wrangler"))
    a = ap.parse_args(argv)
    prefix, plan = r2_plan(a.stage)
    if not plan:
        print("r2_upload: the stage serves nothing from R2 (no hosts.json)")
        return 0
    m = load_manifest(a.manifest)
    keys = m["keys"]
    todo = []
    for key, p in plan:
        data_size = p.stat().st_size
        got = keys.get(key)
        if got and got[0] == data_size:
            sha = hashlib.sha1(p.read_bytes()).hexdigest()
            if got[1] == sha:
                continue
        todo.append((key, p))
    live = {k for k, _ in plan}
    stale = sorted(k for k in keys if k.startswith(prefix) and k not in live) if a.prune else []
    total = sum(p.stat().st_size for _, p in todo)
    n_sets = len({k[len(prefix):].split("/")[0] for k, _ in plan})
    print(f"r2_upload: {len(plan)} files in {n_sets} set(s) under {prefix or '/'}; {len(todo)} to send "
          f"({total / 2**20:.1f} MB)"
          + (f", {len(stale)} to delete" if a.prune else ""))
    if a.dry_run:
        for key, _ in todo[:20]:
            print(f"  would send {key}")
        return 0
    env = os.environ
    bucket = env.get("R2_BUCKET", "")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", bucket):
        raise SystemExit("set R2_BUCKET (the bucket's name)")
    if a.via == "s3":
        missing = [k for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY") if not env.get(k)]
        if missing:
            raise SystemExit(f"set {', '.join(missing)} (an R2 API token's S3 credentials), or pass --via wrangler")
        client = S3(env["R2_ACCOUNT_ID"], bucket, env["R2_ACCESS_KEY_ID"], env["R2_SECRET_ACCESS_KEY"])
    else:
        client = Wrangler(bucket, a.wrangler)
    if a.verify:
        for key in [k for k in keys if k in live]:
            if client.head(key) != keys[key][0]:
                keys.pop(key)
                todo.append((key, dict(plan)[key]))
    lock = threading.Lock()
    done = [0]

    def send(item):
        key, p = item
        body = p.read_bytes()
        ctype, cache = headers_of(p)
        if isinstance(client, Wrangler):
            client.put(key, body, ctype, cache, p)
        else:
            client.put(key, body, ctype, cache)
        with lock:
            keys[key] = [len(body), hashlib.sha1(body).hexdigest()]
            done[0] += 1
            if done[0] % SAVE_EVERY == 0:
                save_manifest(a.manifest, m)
                print(f"  {done[0]}/{len(todo)}", flush=True)

    try:
        with cf.ThreadPoolExecutor(max_workers=1 if a.via == "wrangler" else WORKERS) as ex:
            for f in cf.as_completed([ex.submit(send, it) for it in todo]):
                f.result()
        for key in stale:
            client.delete(key)
            keys.pop(key, None)
    finally:
        save_manifest(a.manifest, m)
    print(f"r2_upload: sent {done[0]} file(s)" + (f", deleted {len(stale)}" if stale else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
