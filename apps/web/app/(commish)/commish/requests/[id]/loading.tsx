import { FacePair } from "@injurysub/ui";
import {
  AutomationStripPlaceholder,
  BackBar,
  LineBar,
} from "../../../../../components/shell/loading-parts";
import { CommishLoadingFrame } from "../../../../../components/shell/shell-frame";

const ROWS = ["first", "second", "third"];

// Shown while a request's detail loads: its own placeholders, with the queue's beside them at
// 1280, not the queue page's that the folder above would show.
export default function DetailLoading() {
  return (
    <CommishLoadingFrame current="queue">
      <div className="page">
        <BackBar href="/commish/requests" label="Queue" phoneOnly />
        <div className="cols">
          <div className="col desk-only">
            <div className="titleblock">
              <div className="t-title">Queue</div>
            </div>
            <div className="list-panel" aria-hidden="true">
              {ROWS.map((row) => (
                <div key={row} className="sk my-(--space-12) h-[72px]" />
              ))}
            </div>
          </div>
          <div className="col flow">
            <AutomationStripPlaceholder />
            <header className="titleblock">
              <LineBar className="t-title" bar="w-[60%]" />
              <div className="swapline mt-(--space-6)">
                <FacePair incoming={{}} outgoing={{ out: true }} />
                <div className="min-w-0 grow">
                  <LineBar className="titleblock-subtitle mt-0" bar="w-[85%]" />
                  <LineBar className="titleblock-subtitle" bar="w-[55%]" />
                </div>
              </div>
            </header>
            <div className="status sk h-[84px]" aria-busy="true" />
          </div>
        </div>
      </div>
    </CommishLoadingFrame>
  );
}
