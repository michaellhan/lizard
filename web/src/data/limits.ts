// The most one import reads into the page. A tab has only so much memory, more so on a phone, and a file over this is
// refused by its size before any of it is read.
export const MAX_IMPORT_BYTES = 256 * 1024 * 1024;
/** The most a restore reads. A backup this page made has to come back, so it stands above the largest a browser can write
 * (a string of about 512 MB, a little more on disk with its card symbols). */
export const MAX_RESTORE_BYTES = 1024 * 1024 * 1024;

const mb = (n: number) => `${Math.ceil(n / (1024 * 1024)).toLocaleString("en-US")} MB`;

/** Why these bytes can't be imported at once, or null where they can. */
export const importTooBig = (bytes: number, advice: string, max = MAX_IMPORT_BYTES): string | null => (bytes > max ? `That's ${mb(bytes)}, over the ${mb(max)} one import can read. ${advice}` : null);
