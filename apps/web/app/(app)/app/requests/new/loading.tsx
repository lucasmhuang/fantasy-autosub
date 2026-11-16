import { SlowNote } from "@injurysub/ui";

const CARDS = [0, 1, 2];

// Shown while Choose or Confirm reads ESPN: option cards' placeholders, and after about 3 seconds
// that the read can take up to 12 (FM-CHOOSE-1), revealed by CSS alone.
export default function ChooseLoading() {
  return (
    <div className="app">
      <main className="shell-main">
        <div className="page single flow">
          <section aria-busy="true">
            <div className="grid2 is-wide">
              {CARDS.map((card) => (
                <div key={card} className="ocard" aria-hidden="true">
                  <div className="ocard-art bg-surface-raised" />
                  <div className="ocard-id">
                    <div className="sk h-[14px] w-[80%]" />
                    <div className="sk mt-(--space-6) h-[10px] w-[50%]" />
                  </div>
                  <div className="ocard-facts">
                    <div className="sk h-[28px]" />
                    <div className="sk h-[28px]" />
                  </div>
                </div>
              ))}
            </div>
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
