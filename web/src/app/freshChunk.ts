// A deploy replaces every hashed file, so a tab opened before it asks for chunks that are gone. Its page isn't broken,
// only old: reload once to get the new one. A second failure in a row is a real one, and goes to the ErrorBoundary.
const KEY = "lizard.chunk-reloaded";

function reloaded(): boolean {
  try {
    if (sessionStorage.getItem(KEY)) return true;
    sessionStorage.setItem(KEY, "1");
  } catch {
    return true; // no way to remember: never risk a reload loop
  }
  return false;
}

function settled() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing was remembered */
  }
}

export async function freshChunk<T>(load: () => Promise<T>): Promise<T> {
  try {
    const chunk = await load();
    settled();
    return chunk;
  } catch (e) {
    if (reloaded()) throw e;
    location.reload();
    return new Promise<T>(() => {}); // the page is going away
  }
}
