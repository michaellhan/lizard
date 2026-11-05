import { NavLink, Outlet, useLocation } from "react-router";
import { BASE_URL } from "@/config";
import { ROUTES } from "./routes";
import { EngineStatusPill } from "@/components/EngineStatusPill";
import { BackupNudge } from "./BackupNudge";
import { DbNotice } from "./DbNotice";
import { ErrorBoundary } from "./ErrorBoundary";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
    isActive ? "bg-surface-3 text-text" : "text-muted hover:bg-surface-2 hover:text-text"
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

export function Shell() {
  return (
    <div className="flex min-h-full flex-col">
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
            className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 pr-6 [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] lg:pr-1 lg:[mask-image:none]"
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
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Page />
      </main>
      <footer className="border-t border-border px-4 py-4 text-center text-xs text-faint">
        Lizard · solver engine from gto-solver · every number is labelled with what produced it
      </footer>
    </div>
  );
}
