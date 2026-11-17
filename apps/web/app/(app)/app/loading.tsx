import { LoadingRows, SlowNote } from "@injurysub/ui";
import { LineBar } from "../../../components/shell/loading-parts";
import { ManagerLoadingFrame } from "../../../components/shell/shell-frame";

const STARTER_SLOTS = ["PG", "SG", "G", "SF", "PF", "F", "C", "C", "UTIL", "UTIL"];

// Shown while the team page reads ESPN through the worker: placeholders the size of the real
// panels, so nothing shifts when the data lands, and after about 3 seconds that the read can take
// up to 12 (FM-BOARD-8), revealed by CSS alone.
export default function TeamPageLoading() {
  return (
    <ManagerLoadingFrame current="team">
      <div className="page">
        <header className="pagehead">
          <div className="min-w-0 grow">
            <LineBar className="t-title" bar="w-[60%]" />
            <LineBar className="pagehead-subtitle" bar="w-[30%]" />
          </div>
        </header>
        <div className="cols">
          <div className="col">
            <section className="headline" aria-busy="true">
              <LineBar className="t-headline" bar="w-[62%]" />
            </section>
            <section className="panel px-(--space-16) pt-(--space-14) pb-(--space-12)">
              <div className="sk h-[12px] w-[50%]" />
              <div className="sk mt-(--space-12) h-[40px] w-[110px]" />
            </section>
            <div className="slow-later">
              <SlowNote>Still reading ESPN. Up to 12 seconds.</SlowNote>
            </div>
          </div>
          <div className="col">
            <div className="fresh">
              <p role="status">Reading ESPN…</p>
            </div>
            <LoadingRows slots={STARTER_SLOTS} />
          </div>
        </div>
      </div>
    </ManagerLoadingFrame>
  );
}
