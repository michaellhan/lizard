# Account sync: design

Decided by the owner on 2026-11-06: Cloudflare Workers + D1, Sign in with Google, end to end encrypted, for saved spots,
session history, imported hands and kept mistakes. An account is optional, and the site stays whole with none. (Sign-in began
as an email magic link through Resend, which the owner tried live on 2026-11-06 and replaced the same day as too much trouble.)

Status: the Worker (`worker/`) has been up on real D1 since 2026-11-06. Sign-in with Google is built and tested against a
stand-in for Google, in the Worker's tests and in two real browsers (`scripts/sync_check.mjs`). It has not run against Google
itself, as the OAuth client doesn't exist yet. See "What the owner has to provide".

## What the server can and can't see

| The server holds | It never holds |
|---|---|
| A keyed hash of the number Google gives your account (HMAC with a Worker secret), to find your account | Your email address or name: it asks Google only for `openid`, so they never reach it |
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

A plain link and two redirects, run by the Worker: OpenID Connect's code flow with PKCE. No Google script runs on the site,
so its `script-src 'self'` and isolation headers (which the engine's threads need) stand unchanged.

1. The button is a link to `GET /lizard/api/auth/google`. The Worker makes a random `state` and PKCE verifier, holds both in a
   10-minute `HttpOnly; Secure; SameSite=Lax` cookie scoped to that path, and redirects to Google with `scope=openid`. (Lax,
   as Google's redirect back is a navigation from another site, which a Strict cookie wouldn't come with.)
2. Google sends the browser to `GET /lizard/api/auth/google/callback?code&state`. The Worker clears the cookie, and goes no
   further unless `state` matches it: that's what stops someone signing you in to their account.
3. The Worker spends the code at Google's token endpoint with the verifier and the client secret. The ID token comes straight
   from Google over TLS, which is why its signature needn't be checked (OpenID Connect Core 3.1.3.7); its issuer, audience,
   expiry and `sub` are.
4. The account is `HMAC(ACCOUNT_HMAC_KEY, "google:" + sub)`. The Worker sets a session cookie: `HttpOnly; Secure;
   SameSite=Strict; Path=/lizard/api`, 30 days, its hash in D1, and redirects to Settings. Anything that goes wrong comes
   back as `#sync-error=cancelled|busy|failed`, which the panel says in words and takes from the address.

What this costs: Google knows you signed in to Lizard, and when. It learns nothing else: synced data doesn't go near it.

Sign out deletes the session row. "Delete my account" deletes the user and every record at once, behind a confirm.

## Requests

All under `/lizard/api/`, same origin as the site, so no CORS is opened: a request with any `Origin` other than the site's
is refused, and every write must carry `X-Lizard: 1`, which a cross-site form can't set.

| Route | Does |
|---|---|
| `GET auth/google`, `GET auth/google/callback`, `POST auth/signout` | Above |
| `GET me` | Signed in or not, salt, check value, bytes used |
| `PUT keys` | Sets the salt and check value, once, or replaces them when resetting the synced copy |
| `GET records?since=<seq>&limit=` | The account's records after a sequence number |
| `POST records` | Up to 100 records or 4 MB; returns the new sequence numbers |
| `DELETE account` | Deletes everything |
| `GET health` | So the page can say the service is up. It answers 503 until the Google secret is set, which keeps the panel hidden |

Limits: 30 sign-ins an IP an hour, 60 writes a minute, 512 KB a record, 250 MB an account. A failure answers with a code and
no detail of why, and nothing logs a body.

## Data

D1 tables in `worker/schema.sql`: `users`, `sessions`, `records`, `rate`. `records` has a per-user
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
and tests. The tests run the real schema on Node's built-in SQLite through a small adapter with D1's calling shape, and a
mocked Google. That isn't D1 or Google: the first deployment needs a live check.

Client code: `web/src/sync/`, with the crypto and merge tested on their own.

## What the owner has to provide

- Cloudflare: a D1 database, created with Wrangler logged in on this Mac. No token goes in the repo's Actions secrets, as
  CI doesn't deploy the Worker.
- Google: a Google Cloud project and an OAuth client of type Web application, with the redirect URI
  `https://www.michael-han.com/lizard/api/auth/google/callback`. `docs/DEPLOYMENT.md` §6 has the steps. Its id goes in
  `wrangler.toml`, as every visitor to Google's page can read it anyway.
- Worker secrets, set with `wrangler secret put`: `GOOGLE_CLIENT_SECRET`, and `ACCOUNT_HMAC_KEY` (32 random bytes). I can
  generate the second, but only in a step that doesn't print it.

No key goes in the repo or the bundle.

## Not in the first version

Sharing, a recovery key, changing a passphrase in place (reset the synced copy instead), settings sync, saved answers
(large, and solved again on demand), and live push between open devices.
