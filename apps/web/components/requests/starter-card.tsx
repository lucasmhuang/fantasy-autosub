import { formatTenths, toTenths } from "@injurysub/domain";
import { Button } from "@injurysub/ui";
import Link from "next/link";
import type { BoardStarter } from "../../lib/server/board";
import { REQUEST_STATUS_LABELS } from "./labels";

// One OUT or suspended starter: who he is, his week, and what a substitution would forfeit.
export function StarterCard({ starter, chosen }: { starter: BoardStarter; chosen: boolean }) {
  const line = starter.weekToDate;
  return (
    <div className="rounded-[1.5rem] border border-white/8 bg-black/15 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-medium">{starter.name}</h3>
          <p className="mt-1 text-sm text-[color:var(--muted)]">
            {starter.proTeam} · {starter.position} · in {starter.slot} ·{" "}
            {starter.designation === "OUT" ? "OUT" : "Suspended"}
          </p>
        </div>
        <p className="text-right text-sm">
          <span className="metric-label block">This week</span>
          {formatTenths(toTenths(line.fantasyPoints))} pts
        </p>
      </div>
      <p className="mt-3 text-xs leading-6 text-[color:var(--muted)]">
        {line.points} PTS · {line.rebounds} REB · {line.assists} AST · {line.steals} STL ·{" "}
        {line.blocks} BLK · {line.turnovers} TO
      </p>
      <p className="mt-1 text-sm">
        A substitution forfeits his {formatTenths(starter.forfeitTenths)} points this week.
      </p>
      <StarterAction starter={starter} chosen={chosen} />
    </div>
  );
}

function StarterAction({ starter, chosen }: { starter: BoardStarter; chosen: boolean }) {
  if (starter.request !== null) {
    return (
      <p className="mt-4 text-sm">
        <Link className="underline" href={`/app/requests/${starter.request.requestId}`}>
          Request for {starter.request.replacementName}:{" "}
          {REQUEST_STATUS_LABELS[starter.request.status]}
        </Link>
      </p>
    );
  }
  if (chosen) return null;
  return (
    <div className="mt-4">
      <Button asChild intent="ghost" size="sm">
        <Link href={`/app?starter=${starter.playerId}`}>Choose a replacement</Link>
      </Button>
    </div>
  );
}
