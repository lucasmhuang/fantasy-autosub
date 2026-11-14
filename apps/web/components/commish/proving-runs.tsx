import { Button } from "@injurysub/ui";
import type { ProvingRequestView, ProvingStop, ProvingWrite } from "../../lib/server/proving";
import { formatReadTime } from "../requests/format";
import { REHEARSAL_REQUEST_TEXT, REQUEST_STATUS_LABELS } from "../requests/labels";
import { MoveList } from "./proving-choices";
import { notRunText, restoreSideText, stopText } from "./proving-text";

const cardClassName = "flex flex-col gap-2 rounded-[1.5rem] border border-white/8 bg-black/15 p-4";
const formClassName = "flex flex-col gap-2";

const STEP_LABELS: Record<ProvingWrite["step"], string> = {
  swap: "The swap",
  token: "The 0.1 test adjustment",
  revert: "Its revert",
  restore: "The lineup put back",
};
const APPROVE_TEXT =
  "Approve: InjurySub swaps the lineup on ESPN, writes 0.1 points with the note “InjurySub test (reverted)”, reverts it, then puts the lineup back. Both adjustment entries show in the league’s activity.";

// S18: every proving request, newest first, with its writes and what can be done with it.
export function ProvingRuns({ requests }: { requests: ProvingRequestView[] }) {
  if (requests.length === 0) {
    return <p className="text-sm text-[color:var(--muted)]">No proving requests yet.</p>;
  }
  return (
    <ul className="grid gap-3">
      {requests.map((request) => (
        <li key={request.requestId} className="min-w-0">
          <ProvingRun request={request} />
        </li>
      ))}
    </ul>
  );
}

function ProvingRun({ request }: { request: ProvingRequestView }) {
  // In review for a reason of its own, not because the run stopped itself (S19).
  const notRun = request.stopped?.step === null ? request.reviewReason : null;
  return (
    <div className={`${cardClassName} text-sm`}>
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-base font-medium">
          {request.replacementName} in for {request.injuredName}
        </span>
        <span className="text-[color:var(--muted)]">{REQUEST_STATUS_LABELS[request.status]}</span>
      </span>
      <span className="text-[color:var(--muted)]">
        Filed {formatReadTime(request.filedAt.toISOString())}
      </span>
      {request.rehearsal ? <span>{REHEARSAL_REQUEST_TEXT}</span> : null}
      {notRun === null ? null : <span>{notRunText(notRun)}</span>}
      <WriteList writes={request.writes} />
      {request.stopped === null ? null : <StopSteps stop={request.stopped} />}
      <RunActions request={request} />
    </div>
  );
}

function WriteList({ writes }: { writes: ProvingWrite[] }) {
  if (writes.length === 0) return null;
  return (
    <ol className="flex flex-col gap-1">
      {writes.map((write) => (
        <li key={write.sentAt.toISOString()} className="break-words">
          {STEP_LABELS[write.step]}: {outcomeText(write)}
          {write.espnAnswer === null ? "" : ` (${write.espnAnswer})`} ·{" "}
          {formatReadTime(write.sentAt.toISOString())}
        </li>
      ))}
    </ol>
  );
}

function outcomeText(write: ProvingWrite): string {
  if (write.status === "recorded_only") return "recorded, not sent";
  if (write.outcome === "verified") return "ESPN shows it";
  if (write.outcome === "not_applied") return "ESPN doesn’t show it";
  if (write.outcome === "ambiguous") return "ESPN shows part of it";
  return write.status === "sending" ? "sent, no answer recorded" : "sent, not read back";
}

// S15: where the run stopped and what to put back on ESPN by hand, from what it sent.
function StopSteps({ stop }: { stop: ProvingStop }) {
  const stopped = stopText(stop.step, stop.detail);
  return (
    <div className="flex flex-col gap-2">
      {stopped === null ? null : <span>{stopped}</span>}
      {stop.earlierDayKeepsSwap ? (
        <span>ESPN’s day changed during the run, so the earlier day keeps the swap.</span>
      ) : null}
      {stop.restoreMoves === null ? null : (
        <>
          <span>Put team 1’s lineup back on ESPN, in this order:</span>
          <MoveList moves={stop.restoreMoves} />
        </>
      )}
      {stop.sideToRestore === null ? null : <span>{restoreSideText(stop.sideToRestore)}</span>}
    </div>
  );
}

function RunActions({ request }: { request: ProvingRequestView }) {
  const version = <input type="hidden" name="version" value={request.version} />;
  return (
    <>
      {request.approve === null ? null : (
        <form
          action={`/commish/requests/${request.requestId}/approve`}
          method="post"
          className={formClassName}
        >
          {version}
          <input type="hidden" name="shownTenths" value={request.approve.shownTenths} />
          <span>{APPROVE_TEXT}</span>
          <Button intent="ghost" size="sm" type="submit" className="self-start">
            Approve
          </Button>
        </form>
      )}
      {request.putBack ? (
        <form
          action={`/commish/requests/${request.requestId}/complete`}
          method="post"
          className={formClassName}
        >
          {version}
          <Button intent="ghost" size="sm" type="submit" className="self-start">
            I put team 1 back
          </Button>
        </form>
      ) : null}
      {request.cancel ? (
        <form action="/commish/proving/cancel" method="post" className={formClassName}>
          {version}
          <input type="hidden" name="request" value={request.requestId} />
          <Button intent="ghost" size="sm" type="submit" className="self-start">
            Cancel
          </Button>
        </form>
      ) : null}
    </>
  );
}
