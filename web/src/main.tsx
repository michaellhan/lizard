import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { BASE_URL } from "./config";
import "./styles/index.css";

// The service worker, cross-origin isolation and the solver's threads all need a secure context, and the site's
// plain-http address is not redirected by the host: move to https before anything else runs.
const LOCAL = ["localhost", "127.0.0.1", "[::1]"];
if (location.protocol === "http:" && !LOCAL.includes(location.hostname)) {
  location.replace(`https:${location.href.slice(location.protocol.length)}`);
}

/**
 * Cross-origin isolation (for the solver's threads) comes from public/sw.js. The first visit registers it and
 * reloads once under it; if isolation still fails (e.g. a browser without service workers, private modes), the
 * solver runs single-threaded, which is slower but gives the same answers.
 */
async function ensureIsolation(): Promise<void> {
  if (self.crossOriginIsolated || !("serviceWorker" in navigator) || import.meta.env.DEV) return;
  try {
    const reg = await navigator.serviceWorker.register(`${BASE_URL}sw.js`, { scope: BASE_URL });
    if (navigator.serviceWorker.controller) return; // controlled but not isolated: don't loop
    const key = "lizard.sw-reloaded";
    if (sessionStorage.getItem(key)) return;
    await navigator.serviceWorker.ready;
    if (reg.active) {
      sessionStorage.setItem(key, "1");
      location.reload();
    }
  } catch {
    /* single-threaded */
  }
}

void ensureIsolation();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
