// A page that throws while drawing would otherwise leave an empty document, on every load if what it drew is stored.
// This keeps a way out: a plain message, a reload, and the backup, which reads the database directly (backupFile.ts) so
// it works whichever page threw, /saved with its own Download button included. The error goes to the console.
import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { BASE_URL } from "@/config";
import { downloadBackup } from "@/features/saved/backupFile";

function Trouble() {
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const backup = async () => {
    setSaid(null);
    try {
      await downloadBackup();
      setSaid({ ok: true, text: "Backup made. It holds what's kept in this browser." });
    } catch (e) {
      console.error("The backup failed:", e);
      setSaid({ ok: false, text: `No backup was made: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  return (
    <section role="alert" aria-label="This page stopped" className="mx-auto max-w-xl space-y-3 rounded-lg border border-warn/50 bg-surface p-4 text-sm">
      <h1 className="text-lg font-semibold">This page stopped working</h1>
      <p>Something on it couldn&rsquo;t be drawn. Reloading may fix it. If it doesn&rsquo;t, download a backup so what&rsquo;s kept in this browser is safe.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => location.reload()} className="rounded-md bg-accent px-3 py-1.5 font-medium text-bg">
          Reload this page
        </button>
        <button type="button" onClick={() => void backup()} className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2">
          Download backup
        </button>
        <a href={BASE_URL} className="underline">
          Go to the home page
        </a>
      </div>
      {said && <p className={said.ok ? "" : "text-danger"}>{said.text}</p>}
    </section>
  );
}

interface Props {
  children: ReactNode;
  /** when this changes (another page, another URL) what's inside is tried again */
  resetKey?: string;
}

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("A page stopped drawing:", error, info.componentStack);
  }

  override componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  override render() {
    return this.state.failed ? <Trouble /> : this.props.children;
  }
}
