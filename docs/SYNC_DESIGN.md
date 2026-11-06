# Account sync: design

Decided by the owner on 2026-11-06: Cloudflare Workers + D1, email magic link through Resend, end to end encrypted, for
saved spots, session history, imported hands and kept mistakes. An account is optional, and the site stays whole with none.

Status: the Worker (`worker/`) has been up on real D1 since 2026-11-06, answering `health` and `me` and refusing a bad origin; no
one has signed in on it, as it has no mail key yet. The client (`web/src/sync/`, `features/settings/SyncPanel.tsx`) is built and
tested against stand-ins, and stays out of the build until `LIZARD_SYNC` is set. No test has yet run on real Resend or two real
browsers against this service. See "What the owner has to provide".

## What the server can and can't see

| The server holds | It never holds |
|---|---|
| A keyed hash of your email (HMAC with a Worker secret), to find your account | Your email address at rest: it's in memory only while a sign-in mail is sent |
| Ciphertext, its size and when it arrived | Your passphrase, or any key that opens a record |
| A random salt and a small encrypted check value, so a second device can tell a wrong passphrase | Record names, ids, or what kind of hand or spot a record is |
| Which of the four kinds each record is, as a number | |

The kind is left in the clear so that a device can ask for one kind and a quota can be counted; everything else about a
record is inside the ciphertext. Sizes and times remain visible, and that's stated in the privacy words.

**A lost passphrase loses the synced copy.** The owner accepted that. The local copy on any device is unharmed, and a new
passphrase can start a new synced copy from it. There's no recovery key in the first version.

## Keys

- The passphrase and the per-account salt go through PBKDF2-SHA-256, 600,000 iterations, in WebCrypto, giving a 256-bit master
  key that stays in memory. It isn't stored unless you choose "stay unlocked on this device", when a non-extractable
  `CryptoKey` goes in IndexedDB.
- HKDF splits the master key into a record key (AES-256-GCM) and an id key (HMAC-SHA-256).
- The id on the server is the HMAC of `store|id`.
- Each record is encrypted with a fresh 96-bit random IV, with `store|` and that hash as additional data, so the server
  can't swap one record's ciphertext for another's.

PBKDF2 rather than Argon2 so no wasm goes in the sign-in path: it's in every browser. A short passphrase is the weak point,
so the form asks for at least 12 characters and says why.

## Sign-in

1. `POST /lizard/api/auth/start {email}`. It answers the same whether or not the account exists. A 256-bit token is made, and
   only its SHA-256 is kept, for 15 minutes, single use.
2. Resend mails a link to `https://www.michael-han.com/lizard/settings#sync-token=...`. The token is in the fragment, so it's
   in no server log and no Referer.
3. Opening the link only loads the page. The page sends `POST /lizard/api/auth/finish {token}`. So a mail scanner that fetches
   links can't spend the token.
4. The Worker sets a session cookie: `HttpOnly; Secure; SameSite=Strict; Path=/lizard/api`, 30 days, its hash in D1.

Sign out deletes the session row. "Delete my account" deletes the user and every record at once, behind a confirm.

## Requests

All under `/lizard/api/`, same origin as the site, so no CORS is opened: a request with any `Origin` other than the site's
is refused, and every write must carry `X-Lizard: 1`, which a cross-site form can't set.

| Route | Does |
|---|---|
| `POST auth/start`, `auth/finish`, `auth/signout` | Above |
| `GET me` | Signed in or not, salt, check value, bytes used |
| `PUT keys` | Sets the salt and check value, once, or replaces them when resetting the synced copy |
| `GET records?since=<seq>&limit=` | The account's records after a sequence number |
| `POST records` | Up to 100 records or 4 MB; returns the new sequence numbers |
| `DELETE account` | Deletes everything |
| `GET health` | So the page can say the service is up |

Limits: 5 sign-in mails an address an hour and 20 an IP an hour, 60 writes a minute, 512 KB a record, 250 MB an account. A
failure answers with a code and no detail of why, and nothing logs a body.

## Data

D1 tables in `worker/schema.sql`: `users`, `login_tokens`, `sessions`, `records`, `rate`. `records` has a per-user
sequence number given by the server, and a write replaces the row for that `(user, store, id_hash)` with a new sequence
number, so a pull is "everything since the last number I saw".

## Merging

The server doesn't merge: it can't read anything. Each device:

1. Pulls what's new, decrypts it, and merges by the rule a restore uses: of two copies the later stays, weighed by the time
   a backup calls `updated` (`LAST_CHANGED` in `data/db.ts`), and a deletion stands against any copy not changed after it.
2. Pushes what differs from the copy the server has, deletions included. It keeps a list, record to time, of what the server
   holds. A deletion is a sealed record that replaces the copy, so its id stays in the ciphertext like any other.

Unlike a restore, a sync's deletion takes the record here, with a tombstone (`data/backup.ts` says why the two differ). It takes
what goes with the record too: a spot's saved answer, a hand's grades. So a device that was offline loses what you deleted
elsewhere, unless its copy was changed after the delete; then that copy comes back everywhere.

A record that won't decrypt, fails its shape check, or sits under another record's hash is skipped and counted on the page,
never written over the local copy. One too large for the service stays here and is counted.

Sync runs when signed in and unlocked: on unlocking, 20 seconds after a save, on leaving and coming back to the page, every
five minutes while it's open, and on demand. One tab runs it at a time. Nothing about Lizard waits for it. Failing, it says so
in Settings and the local data stands, and the next run takes up where it stopped.

Limits of the first version: a run reads every synced record in the browser to find what changed, which is fine for thousands
and slow for a hundred thousand; two copies with the same time keep whichever each device has; a record deleted before
deletions were remembered has no tombstone and can come back from a device that still holds it; "Start fresh" on the recovery
panel brings the synced copy back at the next unlock; and the write limit (60 requests a minute, 100 records each) makes a
first sync of 100,000 hands about 17 minutes.

## In the client

Lazy-loaded, so the first bundle doesn't grow and a visitor with no account fetches none of it. Two gates keep it hidden: the
build leaves the panel out unless `VITE_SYNC=on` (the repo variable `LIZARD_SYNC`), so the site makes no request to a service
that isn't there, and with it in, the panel shows only once `GET health` answers. A browser left unlocked marks `lizard-sync`
in local storage, which is all the first bundle reads.

## Where the code goes

`worker/`, outside `solver/`: its own `package.json`, `wrangler.toml` with no ids or secrets, `schema.sql`, TypeScript source
and tests. The tests run the real schema on Node's built-in SQLite through a small adapter with D1's calling shape, and
mocked Resend. That isn't D1: the first deployment needs a live check.

Client code: `web/src/sync/`, with the crypto and merge tested on their own.

## What the owner has to provide

- Cloudflare: a D1 database, created with Wrangler logged in on this Mac. No token goes in the repo's Actions secrets, as
  CI doesn't deploy the Worker.
- Resend: an account, `michael-han.com` verified with the DNS records it gives, and an API key.
- Worker secrets, set with `wrangler secret put`: `RESEND_API_KEY`, and `EMAIL_HMAC_KEY` (32 random bytes). I can generate
  the second, but only in a step that doesn't print it.

No key goes in the repo or the bundle.

## Not in the first version

Sharing, a recovery key, changing a passphrase in place (reset the synced copy instead), settings sync, saved answers
(large, and solved again on demand), and live push between open devices.
