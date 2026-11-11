import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { BASE_URL } from "@/config";
import { MORE, ROUTES, routeTitle } from "./routes";
import { EngineStatusPill } from "@/components/EngineStatusPill";
import { DbRecovery } from "@/features/saved/DbRecovery";
import { BackupNudge } from "./BackupNudge";
import { DbNotice } from "./DbNotice";
import { ErrorBoundary } from "./ErrorBoundary";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-md px-2 py-1.5 text-sm transition-colors sm:px-3 ${
    isActive ? "bg-surface-3 text-text underline decoration-accent decoration-2 underline-offset-4" : "text-muted hover:bg-surface-2 hover:text-text"
  }`;

interface NavItem {
  path: string;
  label: string;
  blurb?: string;
}

/** Every page the bar can show, in its order: the four main pages, then the others as the More menu lists them. */
const ITEMS: NavItem[] = [...ROUTES.filter((r) => r.nav).map((r) => ({ path: r.path, label: r.label })), ...MORE];
/** the main pages, which stay in the bar (scrolling in it on a phone) however narrow it gets */
const MAIN = ROUTES.filter((r) => r.nav).length;

/** The pages that didn't fit in the bar, behind one button: it closes on a pick, a page change, Escape or a click
 * elsewhere, and is marked while you're on one of its pages. With every page in the bar it's left for a phone, where
 * Settings is reached through it. */
function MoreMenu({ items }: { items: NavItem[] }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(pathname);
  if (at !== pathname) {
    setAt(pathname);
    setOpen(false);
  }
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const here = items.some((m) => pathname.split("/").filter(Boolean)[0] === m.path);
  return (
    <div ref={box} className={`relative shrink-0 ${items.length ? "" : "sm:hidden"}`}>
      <button type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)} className={linkClass({ isActive: here })}>
        More ▾
      </button>
      {open && (
        <div className="popover absolute right-0 top-full z-50 mt-1 w-48 p-1 shadow-lg">
          <ul aria-label="More pages">
            {items.map((m) => (
              <li key={m.path}>
                <NavLink
                  to={`/${m.path}`}
                  title={m.blurb}
                  className={({ isActive }) => `block rounded-md px-3 py-2 text-sm ${isActive ? "bg-surface-3 text-text" : "text-muted hover:bg-surface-2 hover:text-text"}`}
                >
                  {m.label}
                </NavLink>
              </li>
            ))}
            <li className="sm:hidden">
              <NavLink to="/settings" className="block rounded-md px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-text">
                Settings
              </NavLink>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

/** How many of the bar's pages fit in `room`, from each one's width, More's and the gap between them: all of them where
 * they fit with no More, else as many as leave room for More, and never fewer than the main pages. */
export function fitCount(widths: number[], more: number, gap: number, room: number): number {
  const total = widths.reduce((a, w) => a + w, 0) + gap * Math.max(0, widths.length - 1);
  if (total <= room) return widths.length;
  const left = room - more - gap;
  let used = 0;
  let n = 0;
  for (; n < widths.length; n++) {
    const next = used + (n ? gap : 0) + widths[n]!;
    if (next > left) break;
    used = next;
  }
  return Math.max(MAIN, n);
}

/** The primary nav: every page that fits, the rest under More. A hidden copy of the bar, every page in it, gives each
 * one's width; the bar's own width and that copy's (it changes as the font loads) are watched. */
function PrimaryNav() {
  const nav = useRef<HTMLElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(MAIN);
  useLayoutEffect(() => {
    const bar = nav.current;
    const row = ruler.current;
    if (!bar || !row || typeof ResizeObserver !== "function") return;
    const fit = () => {
      const widths = [...row.children].map((c) => c.getBoundingClientRect().width);
      const more = widths.pop() ?? 0;
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const cs = getComputedStyle(bar);
      const room = bar.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      setShown(fitCount(widths, more, gap, room));
    };
    fit();
    const seen = new ResizeObserver(fit);
    seen.observe(bar);
    seen.observe(row);
    return () => seen.disconnect();
  }, []);
  return (
    <nav ref={nav} aria-label="Primary" className="segmented relative -mx-1 flex min-w-0 flex-1 items-center gap-0.5 px-1 sm:gap-1">
      <div className="flex min-w-0 gap-0.5 overflow-x-auto [scrollbar-width:none] sm:gap-1">
        {ITEMS.slice(0, shown).map((r) => (
          <NavLink key={r.path} to={`/${r.path}`} title={r.blurb} className={linkClass}>
            {r.label}
          </NavLink>
        ))}
      </div>
      <MoreMenu items={ITEMS.slice(shown)} />
      <div aria-hidden="true" className="pointer-events-none invisible absolute inset-0 overflow-hidden">
        <div ref={ruler} className="flex w-max gap-0.5 sm:gap-1">
          {ITEMS.map((r) => (
            <span key={r.path} className={linkClass({ isActive: false })}>
              {r.label}
            </span>
          ))}
          <span className={linkClass({ isActive: false })}>More ▾</span>
        </div>
      </div>
    </nav>
  );
}

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
        <div className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 lg:px-6">
          <NavLink to="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight" aria-label="Lizard home">
            <img src={`${BASE_URL}lizard.svg`} alt="" className="h-7 w-7" />
            <span className="hidden text-lg sm:inline">Lizard</span>
          </NavLink>
          <PrimaryNav />
          <div className="flex shrink-0 items-center gap-2">
            <EngineStatusPill />
            <NavLink to="/settings" className={(a) => `hidden sm:inline-block ${linkClass(a)}`} aria-label="Settings">
              ⚙
            </NavLink>
          </div>
        </div>
      </header>
      <DbNotice />
      <DbRecovery />
      <BackupNudge />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 scroll-mt-16 px-4 py-8 [&_h1]:scroll-mt-20">
        <Page />
      </main>
      <footer className="px-4 pb-6 pt-10 text-center text-xs text-faint">
        Lizard · solver engine from gto-solver · every number is labelled with what produced it
      </footer>
    </div>
  );
}
