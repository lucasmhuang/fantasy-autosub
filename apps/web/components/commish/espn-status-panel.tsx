import type { RuleMismatch } from "@injurysub/espn";
import type { EspnStatus } from "../../lib/server/commish";
import { formatReadTime } from "../requests/format";

const STATE_TEXT: Record<EspnStatus["state"], string> = {
  working: "ESPN is working: the credentials are accepted and the league's rules match.",
  rules_mismatch: "ESPN's league rules differ from InjurySub's, so adjustments are held:",
  credentials_rejected: "ESPN refuses the credentials: the cookie needs renewing.",
  unreachable: "ESPN can't be reached right now.",
  not_connected: "ESPN isn't connected yet: the worker has no cookie.",
};

function mismatchText(mismatch: RuleMismatch): string {
  if (mismatch.kind === "setting") {
    return `${mismatch.setting}: ESPN has ${mismatch.espn}, InjurySub expects ${mismatch.expected}`;
  }
  return `${mismatch.name}, day ${mismatch.scoringPeriodId}: ESPN scored ${mismatch.espnPoints}, the league formula gives ${mismatch.formulaPoints}`;
}

// ESPN's access state and when it was checked (O1).
export function EspnStatusPanel({ status }: { status: EspnStatus }) {
  const tone = status.state === "working" ? "var(--success)" : "var(--warning)";
  return (
    <div className="rounded-[1.5rem] border border-white/8 bg-black/15 p-4 text-sm">
      <p style={{ color: tone }}>{STATE_TEXT[status.state]}</p>
      {status.mismatches.length === 0 ? null : (
        <ul className="mt-2 grid gap-1">
          {status.mismatches.map((mismatch) => (
            <li key={mismatchText(mismatch)}>{mismatchText(mismatch)}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-[color:var(--muted)]">
        Checked {formatReadTime(status.checkedAt)}.
      </p>
    </div>
  );
}
