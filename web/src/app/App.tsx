import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { BASE_URL } from "@/config";
import { useSettings } from "@/state/settings";
import { Shell } from "./Shell";
import { SelectMenu } from "@/components/SelectMenu";
import { HomePage } from "@/features/home/HomePage";
import { NotFoundPage } from "@/features/home/NotFoundPage";
import { freshChunk } from "./freshChunk";

// Each page comes with its route, so the first download holds the shell and the home page alone
// (IMPLEMENTATION_PLAN.md: bundle size, code splitting, "do not preload PLO").
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => freshChunk(load).then((m) => ({ default: m[name] })));

/** Review and the plan are Progress now: an old /review or /plan link (its query too, ?retry=next) lands there. */
function ToProgress() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/progress", search }} replace />;
}

const StudyPage = page(() => import("@/features/study/StudyPage"), "StudyPage");
const PracticePage = page(() => import("@/features/practice/PracticePage"), "PracticePage");
const LibraryPage = page(() => import("@/features/library/LibraryPage"), "LibraryPage");
const EnginePage = page(() => import("@/features/engine/EnginePage"), "EnginePage");
const SettingsPage = page(() => import("@/features/settings/SettingsPage"), "SettingsPage");
const RangesPage = page(() => import("@/features/ranges/RangesPage"), "RangesPage");
const SavedPage = page(() => import("@/features/saved/SavedPage"), "SavedPage");
const HistoryPage = page(() => import("@/features/history/HistoryPage"), "HistoryPage");
const ReviewPage = page(() => import("@/features/review/ReviewPage"), "ReviewPage");
const AnalyzePage = page(() => import("@/features/analyze/AnalyzePage"), "AnalyzePage");
const ReportsPage = page(() => import("@/features/reports/ReportsPage"), "ReportsPage");
const ComparePage = page(() => import("@/features/compare/ComparePage"), "ComparePage");
const EquityPage = page(() => import("@/features/equity/EquityPage"), "EquityPage");
const PloRiverPage = page(() => import("@/features/plo/PloRiverPage"), "PloRiverPage");
// (only in a build with VITE_ARENA=on: without it the route, and every byte of the page, stay out)
const ArenaPage = import.meta.env.VITE_ARENA === "on" ? page(() => import("@/features/arena/ArenaPage"), "ArenaPage") : null;
const SolvePageWith = lazy(() =>
  freshChunk(() => import("@/features/solve/SolvePage")).then((m) => ({
    default: m.SolvePage,
  })),
);
const SolvePage = () => <SolvePageWith />;
const TournamentsPage = () => <SolvePageWith kind="tournament" />;

function Pages() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading</p>}>
      <Outlet />
    </Suspense>
  );
}

export function App() {
  const load = useSettings((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <BrowserRouter basename={BASE_URL.replace(/\/$/, "")}>
      <Routes>
        <Route element={<Shell />}>
          <Route element={<Pages />}>
            <Route index element={<HomePage />} />
            <Route path="study" element={<StudyPage />} />
            <Route path="ranges" element={<RangesPage />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="plan" element={<ToProgress />} />
            <Route path="review" element={<ToProgress />} />
            <Route path="progress" element={<ReviewPage />} />
            <Route path="saved" element={<SavedPage />} />
            <Route path="engine" element={<EnginePage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="practice" element={<PracticePage />} />
            <Route path="analyze" element={<AnalyzePage />} />
            <Route path="solve" element={<SolvePage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="tournaments" element={<TournamentsPage />} />
            <Route path="compare" element={<ComparePage />} />
            <Route path="equity" element={<EquityPage />} />
            <Route path="plo" element={<PloRiverPage />} />
            {ArenaPage && <Route path="arena" element={<ArenaPage />} />}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
      <SelectMenu />
    </BrowserRouter>
  );
}
