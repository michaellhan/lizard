// The most one import reads into the page. A tab has only so much memory, more so on a phone, and a file over this is
// refused by its size before any of it is read.
export const MAX_IMPORT_BYTES = 256 * 1024 * 1024;

const mb = (n: number) => `${Math.ceil(n / (1024 * 1024)).toLocaleString("en-US")} MB`;

/** Why these bytes can't be imported at once, or null where they can. */
export const importTooBig = (bytes: number, advice: string): string | null => (bytes > MAX_IMPORT_BYTES ? `That's ${mb(bytes)}, over the ${mb(MAX_IMPORT_BYTES)} one import can read. ${advice}` : null);
