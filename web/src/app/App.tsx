import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { BASE_URL } from "@/config";
import { useSettings } from "@/state/settings";
import { Shell } from "./Shell";
import { HomePage } from "@/features/home/HomePage";
import { StudyPage } from "@/features/study/StudyPage";
import { PracticePage } from "@/features/practice/PracticePage";
import { LibraryPage } from "@/features/library/LibraryPage";
import { EnginePage } from "@/features/engine/EnginePage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { RangesPage } from "@/features/ranges/RangesPage";
import { SavedPage } from "@/features/saved/SavedPage";
import { ClassicFeaturePage } from "@/features/classic/ClassicFeaturePage";
import { NotFoundPage } from "@/features/home/NotFoundPage";

export function App() {
  const load = useSettings((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <BrowserRouter basename={BASE_URL.replace(/\/$/, "")}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<HomePage />} />
          <Route path="study" element={<StudyPage />} />
          <Route path="ranges" element={<RangesPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="saved" element={<SavedPage />} />
          <Route path="engine" element={<EnginePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="practice" element={<PracticePage />} />
          <Route path="analyze" element={<ClassicFeaturePage feature="analyze" />} />
          <Route path="solve" element={<ClassicFeaturePage feature="solve" />} />
          <Route path="reports" element={<ClassicFeaturePage feature="reports" />} />
          <Route path="tournaments" element={<ClassicFeaturePage feature="tournaments" />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
