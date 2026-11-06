// End-to-end encryption for sync (docs/SYNC_DESIGN.md), in WebCrypto so no wasm joins the path. A passphrase and the
// account's salt give a master key; HKDF splits it into one key that seals records and one that hashes their ids. Neither
// can be read back out of the browser (`extractable: false`) and neither leaves it. The server sees ciphertext, and the
// hash of an id. A record is bound to its place with additional data, so the server can't swap two of them unnoticed.
export const ITERATIONS = 600_000;
export const MIN_PASSPHRASE = 12;
/** the format, first byte of every sealed record */
const VERSION = 1;
const IV_BYTES = 12;
const CHECK = "lizard-sync check v1";

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const raw = atob(s);
  const b = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) b[i] = raw.charCodeAt(i);
  return b;
}

export interface SyncKeys {
  seal: CryptoKey;
  ids: CryptoKey;
}

export const newSalt = () => toBase64(crypto.getRandomValues(new Uint8Array(16)));

/** The keys of a passphrase: slow on purpose. A phrase typed on another keyboard with the same letters gives the same keys. */
export async function deriveKeys(passphrase: string, salt: string): Promise<SyncKeys> {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromBase64(salt), iterations: ITERATIONS }, base, 256);
  const master = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  const hkdf = (info: string) => ({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode(info) });
  return {
    seal: await crypto.subtle.deriveKey(hkdf("lizard-sync seal v1"), master, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]),
    ids: await crypto.subtle.deriveKey(hkdf("lizard-sync ids v1"), master, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]),
  };
}

/** What the server files a record under: reveals neither the id nor which of two records share one across stores. */
export async function idHash(keys: SyncKeys, store: number, id: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", keys.ids, enc.encode(`${store}|${id}`));
  return [...new Uint8Array(mac)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function sealBytes(keys: SyncKeys, plain: Uint8Array<ArrayBuffer>, place: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(place) }, keys.seal, plain));
  const out = new Uint8Array(1 + iv.length + ct.length);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(ct, 1 + iv.length);
  return toBase64(out);
}

/** null where it won't open: another key, another place, or changed in any way. */
async function openBytes(keys: SyncKeys, body: string, place: string): Promise<Uint8Array | null> {
  try {
    const b = fromBase64(body);
    if (b[0] !== VERSION || b.length <= 1 + IV_BYTES) return null;
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(1, 1 + IV_BYTES), additionalData: enc.encode(place) }, keys.seal, b.subarray(1 + IV_BYTES)));
  } catch {
    return null;
  }
}

const placeOf = (store: number, hash: string) => `${store}|${hash}`;

export const sealRecord = (keys: SyncKeys, store: number, hash: string, value: unknown) => sealBytes(keys, enc.encode(JSON.stringify(value)), placeOf(store, hash));

/** A record's value, or null where it won't open or isn't JSON. What's opened still needs its shape checked. */
export async function openRecord(keys: SyncKeys, store: number, hash: string, body: string): Promise<unknown> {
  const b = await openBytes(keys, body, placeOf(store, hash));
  if (!b) return null;
  try {
    return JSON.parse(dec.decode(b));
  } catch {
    return null;
  }
}

/** A small sealed value that tells a device whether a passphrase is the account's, before anything's merged. */
export const makeCheck = (keys: SyncKeys) => sealBytes(keys, enc.encode(CHECK), "check");
export const passesCheck = async (keys: SyncKeys, check: string) => {
  const b = await openBytes(keys, check, "check");
  return b != null && dec.decode(b) === CHECK;
};
