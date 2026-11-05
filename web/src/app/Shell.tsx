import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { BASE_URL } from "@/config";
import { ROUTES, routeTitle } from "./routes";
import { EngineStatusPill } from "@/components/EngineStatusPill";
import { BackupNudge } from "./BackupNudge";
import { DbNotice } from "./DbNotice";
import { ErrorBoundary } from "./ErrorBoundary";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
    isActive ? "bg-surface-3 text-text underline decoration-accent decoration-2 underline-offset-4" : "text-muted hover:bg-surface-2 hover:text-text"
  }`;

/** The page, with what's left of the app round it if it throws: going to another page tries again. (Here, not in Shell,
 * so a change of the URL's search renders only this.) */
function Page() {
  const { pathname, search } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname + search}>
      <Outlet />
    </ErrorBoundary>
  );
}

/** The tab's title follows the route, from the first load on. Going to another page takes the keyboard to that page's
 * heading (its <main> where a page has none yet) and says where it landed; the first load takes nothing, and a change of
 * the query alone, as Study walks a line, or of the hash, as the skip link, isn't another page. */
function RouteChange() {
  const { pathname } = useLocation();
  const title = routeTitle(pathname);
  const [said, setSaid] = useState({ pathname, text: "" });
  if (said.pathname !== pathname) setSaid({ pathname, text: title });
  const seen = useRef(pathname);
  useEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(() => {
    if (seen.current === pathname) return;
    seen.current = pathname;
    const main = document.getElementById("main");
    const heading = main?.querySelector("h1");
    heading?.setAttribute("tabindex", "-1");
    (heading ?? main)?.focus();
  }, [pathname]);
  return (
    <p aria-live="polite" className="sr-only">
      {said.text}
    </p>
  );
}

export function Shell() {
  return (
    <div className="flex min-h-full flex-col">
      <RouteChange />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface-3 focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2">
          <NavLink to="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight" aria-label="Lizard home">
            <img src={`${BASE_URL}lizard.svg`} alt="" className="h-7 w-7" />
            <span className="text-lg">Lizard</span>
          </NavLink>
          <nav
            aria-label="Primary"
            className="segmented -mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 pr-6 [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] xl:pr-1 xl:[mask-image:none]"
          >
            {ROUTES.filter((r) => r.nav).map((r) => (
              <NavLink key={r.path} to={`/${r.path}`} className={linkClass}>
                {r.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <EngineStatusPill />
            <NavLink to="/settings" className={linkClass} aria-label="Settings">
              ⚙
            </NavLink>
          </div>
        </div>
      </header>
      <DbNotice />
      <BackupNudge />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 scroll-mt-16 px-4 py-6 [&_h1]:scroll-mt-20">
        <Page />
      </main>
      <footer className="border-t border-border px-4 py-4 text-center text-xs text-faint">
        Lizard · solver engine from gto-solver · every number is labelled with what produced it
      </footer>
    </div>
  );
}
