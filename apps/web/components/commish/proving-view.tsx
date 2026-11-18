import { randomUUID } from "node:crypto";
import { Button, Notice, ReadBack } from "@injurysub/ui";
import { renderCommissionerStatus } from "../../app/(commish)/commish/status-messages";
import type { PageAutomation } from "../../lib/server/commish-alerts";
import type { ProvingChoices, ProvingPage, ProvingRequestView } from "../../lib/server/proving";
import { AddressStatusNotice } from "../board/status-notice";
import { CommishTitle } from "./commish-title";
import { ProvingFileForm, ProvingStarterPicker } from "./proving-form";
import {
  ACTIVITY_WARNING,
  BOTH_DONE,
  NO_BOARD_TEXT,
  notRunText,
  provingDoneText,
  REHEARSAL_REQUEST_TEXT,
  restoreMovesText,
  restoreSideText,
  runSteps,
  startTitle,
  stopText,
} from "./proving-text";

type Found = Extract<ProvingPage, { status: "found" }>;

const APPROVE_TEXT =
  "Approve: InjurySub swaps the lineup on ESPN, writes 0.1 points with the note “InjurySub test (reverted)”, reverts it, then puts the lineup back.";

// The proving run (FS-PROVING-1 to -5): the first live test on the commissioner's own team,
// reached from Settings. The page shows each run as of its load (Revision 4, K).
export function ProvingView(props: {
  page: Found;
  automation: PageAutomation;
  status: string | undefined;
  zone: string;
  now: Date;
}) {
  const { page, zone } = props;
  // Runs that went to ESPN and finished, oldest first: the two proving needs (FS-PROVING-5).
  const finished = page.requests
    .filter((request) => request.status === "completed" && !request.rehearsal)
    .map((request) => request.requestId)
    .reverse();
  return (
    <div className="page form flow">
      <CommishTitle
        title="Proving run"
        sub="Tests every ESPN change InjurySub makes on your team, then puts it back."
        automation={props.automation}
        from="/commish/proving"
        zone={zone}
        now={props.now}
      />
      <AddressStatusNotice status={props.status} render={renderCommissionerStatus} />
      {page.provingDoneAt !== null ? (
        <Notice tone="info">{provingDoneText(page.provingDoneAt, zone)}</Notice>
      ) : (
        <>
          {finished.length >= 2 && <Notice tone="info">{BOTH_DONE}</Notice>}
          <Notice tone="wait">{ACTIVITY_WARNING}</Notice>
          <StartPanel choices={page.choices} finished={finished.length} />
        </>
      )}
      {page.requests.map((request) => {
        const index = finished.indexOf(request.requestId);
        return (
          <ProvingRun
            key={request.requestId}
            request={request}
            number={index === -1 ? null : index + 1}
            zone={zone}
          />
        );
      })}
    </div>
  );
}

function StartPanel(props: { choices: ProvingChoices | null; finished: number }) {
  const { choices } = props;
  if (choices === null) return null;
  if (choices.status === "no_matchup") {
    return (
      <Notice tone="info">
        {"Your team has no matchup this week, so proving can\u2019t run."}
      </Notice>
    );
  }
  if (choices.status !== "found")
    return <Notice tone="info">{NO_BOARD_TEXT[choices.status]}</Notice>;
  return (
    <section className="panel stack-12 px-(--space-16) py-(--space-12)" aria-labelledby="h-pv">
      <h2 id="h-pv" className="t-label">
        {startTitle(props.finished)}
      </h2>
      <ProvingStarterPicker choices={choices} />
      {choices.chosen !== null && (
        <ProvingFileForm
          injured={choices.chosen}
          options={choices.options}
          period={choices.period}
          idempotencyKey={randomUUID()}
        />
      )}
    </section>
  );
}

// One run: its four steps, why it stopped and what to put back, and what can be done with it.
// `number` counts the finished runs; a run that didn't finish has none.
export function ProvingRun(props: {
  request: ProvingRequestView;
  number: number | null;
  zone: string;
}) {
  const { request, zone } = props;
  const stopped = request.stopped !== null && request.stopped.step !== null;
  const steps = runSteps({ ...request, stopped }, zone);
  const id = `run-${request.requestId}`;
  return (
    <section className="panel stack-8 px-(--space-16) py-(--space-12)" aria-labelledby={id}>
      {props.number !== null && (
        <div className="panel-head">
          <span className="state">
            {props.number <= 2 ? `Request ${props.number} of 2` : `Request ${props.number}`}
          </span>
        </div>
      )}
      <ReadBack
        id={id}
        title={`${request.replacementName} in for ${request.injuredName}`}
        lines={steps.map((step) => ({
          kind: step.kind,
          text: (
            <>
              <b>{step.title}</b>
              <br />
              {step.detail}
            </>
          ),
          when: step.when,
        }))}
      />
      {request.rehearsal && <p className="text-[13px] text-text-meta">{REHEARSAL_REQUEST_TEXT}</p>}
      <RunNotes request={request} />
      <RunActions request={request} />
    </section>
  );
}

function RunNotes({ request }: { request: ProvingRequestView }) {
  const stop = request.stopped;
  if (stop === null) return null;
  if (stop.step === null) {
    return request.reviewReason === null ? null : (
      <p className="text-[14px] text-text-2">{notRunText(request.reviewReason)}</p>
    );
  }
  const parts = [
    stopText(stop.step, stop.detail),
    stop.earlierDayKeepsSwap
      ? "ESPN’s day changed during the run, so the earlier day keeps the swap."
      : null,
    stop.restoreMoves === null ? null : restoreMovesText(stop.restoreMoves),
    stop.sideToRestore === null ? null : restoreSideText(stop.sideToRestore),
  ].filter((part): part is string => part !== null);
  return <Notice tone="fail">{parts.join(" ")}</Notice>;
}

// Approve, Cancel and "I put team 1 back": the canvas draws none, but a waiting or stopped run
// needs them (Revision 4, J).
function RunActions({ request }: { request: ProvingRequestView }) {
  const version = <input type="hidden" name="version" value={request.version} />;
  if (request.approve === null && !request.putBack && !request.cancel) return null;
  return (
    <div className="stack-8">
      {request.approve !== null && <p className="text-[13px] text-text-meta">{APPROVE_TEXT}</p>}
      <div className="flex flex-wrap gap-(--space-8)">
        {request.approve !== null && (
          <form action={`/commish/requests/${request.requestId}/approve`} method="post">
            {version}
            <input type="hidden" name="shownTenths" value={request.approve.shownTenths} />
            <Button variant="confirm" type="submit">
              Approve
            </Button>
          </form>
        )}
        {request.putBack && (
          <form action={`/commish/requests/${request.requestId}/complete`} method="post">
            {version}
            <Button variant="quiet" type="submit">
              I put team 1 back
            </Button>
          </form>
        )}
        {request.cancel && (
          <form action="/commish/proving/cancel" method="post">
            {version}
            <input type="hidden" name="request" value={request.requestId} />
            <Button variant="quiet" type="submit">
              Cancel
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
