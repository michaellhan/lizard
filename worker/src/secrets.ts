// Tokens and hashes, in WebCrypto as the Workers runtime has it.
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

export async function hmac(key: string, s: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(s)));
}

const url64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

/** 256 random bits, URL-safe. */
export const token = () => url64(crypto.getRandomValues(new Uint8Array(32)));

/** What Google is shown of a verifier before it's handed over (PKCE, S256). */
export const challenge = async (verifier: string) => url64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));
