import { LoadingRows, SlowNote } from "@injurysub/ui";

const SLOTS = ["G", "G", "F", "F", "C"];

// Shown while the filing form reads the team from ESPN: rows the size of its pick rows, and after
// about 3 seconds that the read can take up to 12, revealed by CSS alone.
export default function FilingLoading() {
  return (
    <div className="app">
      <main className="shell-main">
        <div className="page form flow">
          <header className="titleblock">
            <h1 className="t-title">File for a manager</h1>
          </header>
          <section aria-busy="true">
            <LoadingRows slots={SLOTS} />
          </section>
          <p className="text-[13px] text-text-meta" role="status">
            Reading ESPN…
          </p>
          <div className="slow-later">
            <SlowNote>Still reading ESPN. Up to 12 seconds.</SlowNote>
          </div>
        </div>
      </main>
    </div>
  );
}
