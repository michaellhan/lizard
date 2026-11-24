"""scripts/library/r2_upload.py: what it sends, the signature, and the manifest that makes it resumable. No network: the
bucket is a fake.

Run: .venv/bin/python -m unittest discover -s scripts/library -p test_r2_upload.py
"""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import r2_upload as R  # noqa: E402

ENV = {"R2_BUCKET": "lizard-library", "R2_ACCOUNT_ID": "0" * 32, "R2_ACCESS_KEY_ID": "k", "R2_SECRET_ACCESS_KEY": "s"}


class Bucket:
    """The S3 client, faked: what was put, and a put that fails after `fail_after`."""
    objects: dict = {}
    puts: list = []
    fail_after = None

    def __init__(self, account, bucket, access_key, secret):
        self.bucket = bucket

    def put(self, key, body, content_type, cache):
        if Bucket.fail_after is not None and len(Bucket.puts) >= Bucket.fail_after:
            raise OSError("connection reset")
        Bucket.puts.append((key, content_type, cache))
        Bucket.objects[key] = body

    def head(self, key):
        return len(Bucket.objects[key]) if key in Bucket.objects else None

    def delete(self, key):
        Bucket.objects.pop(key, None)


def stage(d: Path, sets=("mw_utg_sb_bb",), base="https://lib.example.com/lizard-library/"):
    (d / "index.json").write_text("{}")
    for s in sets + ("srp_btn_bb",):
        (d / s).mkdir(parents=True, exist_ok=True)
        (d / s / "KcTd5h.bin").write_bytes(s.encode() * 10)
        (d / s / "heads.json").write_text(json.dumps({"spot": s}))
    (d / "hosts.json").write_text(json.dumps({"format": 1, "hosts": {"r2": base}, "sets": {s: "r2" for s in sets}}))


def run(*args):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), mock.patch.object(R, "S3", Bucket), mock.patch.dict(os.environ, ENV):
        R.main(list(args))
    return out.getvalue()


class Signature(unittest.TestCase):
    def test_the_aws_example_get(self):
        """AWS's own Signature V4 example for S3 (GET /test.txt with a Range header, us-east-1)."""
        h = {"host": "examplebucket.s3.amazonaws.com", "range": "bytes=0-9",
             "x-amz-content-sha256": R.EMPTY_SHA256, "x-amz-date": "20130524T000000Z"}
        auth = R.sign_v4("GET", "https://examplebucket.s3.amazonaws.com/test.txt", h, R.EMPTY_SHA256,
                         "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "20130524T000000Z",
                         region="us-east-1")
        self.assertEqual(auth, "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, "
                               "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, "
                               "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41")


class Upload(unittest.TestCase):
    def setUp(self):
        Bucket.objects, Bucket.puts, Bucket.fail_after = {}, [], None
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)
        self.st = self.d / "stage"
        self.st.mkdir()
        self.man = self.d / "manifest.json"

    def tearDown(self):
        self.tmp.cleanup()

    def test_sends_only_the_r2_sets_under_the_bases_path_with_their_headers(self):
        stage(self.st)
        run("--stage", str(self.st), "--manifest", str(self.man))
        self.assertEqual(sorted(Bucket.puts), [
            ("lizard-library/mw_utg_sb_bb/KcTd5h.bin", "application/octet-stream", R.BIN_CACHE),
            ("lizard-library/mw_utg_sb_bb/heads.json", "application/json", R.JSON_CACHE)])
        self.assertEqual(Bucket.objects["lizard-library/mw_utg_sb_bb/KcTd5h.bin"], b"mw_utg_sb_bb" * 10)

    def test_a_second_run_sends_only_what_changed(self):
        stage(self.st)
        run("--stage", str(self.st), "--manifest", str(self.man))
        Bucket.puts.clear()
        self.assertIn("0 to send", run("--stage", str(self.st), "--manifest", str(self.man)))
        self.assertEqual(Bucket.puts, [])
        (self.st / "mw_utg_sb_bb" / "KcTd5h.bin").write_bytes(b"rebuilt" * 10)
        run("--stage", str(self.st), "--manifest", str(self.man))
        self.assertEqual([k for k, _, _ in Bucket.puts], ["lizard-library/mw_utg_sb_bb/KcTd5h.bin"])

    def test_a_run_that_stops_resumes_where_it_was(self):
        stage(self.st, sets=("a_set", "b_set", "c_set"))
        Bucket.fail_after = 2
        with self.assertRaises(OSError):
            run("--stage", str(self.st), "--manifest", str(self.man))
        kept = json.loads(self.man.read_text())["keys"]
        self.assertEqual(len(kept), 2)       # (saved on the way out)
        Bucket.fail_after = None
        sent = [k for k, _, _ in Bucket.puts]
        Bucket.puts.clear()
        run("--stage", str(self.st), "--manifest", str(self.man))
        self.assertEqual(len(Bucket.puts), 4)
        self.assertFalse(set(sent) & {k for k, _, _ in Bucket.puts})

    def test_verify_resends_what_the_bucket_lost(self):
        stage(self.st)
        run("--stage", str(self.st), "--manifest", str(self.man))
        Bucket.objects.pop("lizard-library/mw_utg_sb_bb/heads.json")
        Bucket.puts.clear()
        run("--stage", str(self.st), "--manifest", str(self.man), "--verify")
        self.assertEqual([k for k, _, _ in Bucket.puts], ["lizard-library/mw_utg_sb_bb/heads.json"])

    def test_prune_deletes_sets_back_on_pages(self):
        stage(self.st, sets=("a_set", "b_set"))
        run("--stage", str(self.st), "--manifest", str(self.man))
        (self.st / "hosts.json").write_text(json.dumps({"format": 1, "hosts": {"r2": "https://lib.example.com/lizard-library/"},
                                                        "sets": {"a_set": "r2"}}))
        run("--stage", str(self.st), "--manifest", str(self.man))
        self.assertIn("lizard-library/b_set/KcTd5h.bin", Bucket.objects)      # (not without --prune)
        run("--stage", str(self.st), "--manifest", str(self.man), "--prune")
        self.assertEqual(sorted(Bucket.objects), ["lizard-library/a_set/KcTd5h.bin", "lizard-library/a_set/heads.json"])
        self.assertEqual(sorted(json.loads(self.man.read_text())["keys"]), sorted(Bucket.objects))

    def test_dry_run_and_no_hosts(self):
        stage(self.st)
        self.assertIn("2 to send", run("--stage", str(self.st), "--manifest", str(self.man), "--dry-run"))
        self.assertEqual(Bucket.puts, [])
        self.assertFalse(self.man.exists())
        (self.st / "hosts.json").unlink()
        self.assertIn("serves nothing from R2", run("--stage", str(self.st), "--manifest", str(self.man)))

    def test_refuses_a_bad_hosts_file(self):
        for base in ("http://lib.example.com/x/", "https://lib.example.com/x", "https://lib.example.com/x/?a=1"):
            with self.subTest(base=base):
                stage(self.st, base=base)
                with self.assertRaises(SystemExit):
                    run("--stage", str(self.st), "--manifest", str(self.man))
        stage(self.st)
        (self.st / "hosts.json").write_text(json.dumps({"format": 1, "hosts": {"r2": "https://l.example.com/"},
                                                        "sets": {"../etc": "r2"}}))
        with self.assertRaises(SystemExit):
            run("--stage", str(self.st), "--manifest", str(self.man))

    def test_needs_credentials(self):
        stage(self.st)
        out = io.StringIO()
        with contextlib.redirect_stdout(out), mock.patch.dict(os.environ, {"R2_BUCKET": "lizard-library"}, clear=True):
            with self.assertRaises(SystemExit) as e:
                R.main(["--stage", str(self.st), "--manifest", str(self.man)])
        self.assertIn("R2_ACCESS_KEY_ID", str(e.exception))


if __name__ == "__main__":
    unittest.main()
