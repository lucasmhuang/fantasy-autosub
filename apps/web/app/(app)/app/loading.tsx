import { Surface } from "../../../components/shell/site-shell";

// Shown while a page under /app loads; the team page reads ESPN through the worker, which can
// take a few seconds.
export default function TeamPageLoading() {
  return (
    <main className="page-shell">
      <div className="page-inner flex flex-col gap-6">
        <Surface className="rounded-[2rem] p-6 sm:p-8">
          <p className="display-kicker">Injury substitutions</p>
          <p className="mt-6 text-sm text-[color:var(--muted)]">Loading…</p>
        </Surface>
      </div>
    </main>
  );
}
