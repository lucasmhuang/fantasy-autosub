import { formatTenths } from "@injurysub/domain";
import type { OnBehalfFiling } from "../../lib/server/commish";
import { formatReadTime } from "../requests/format";

const GAME_TEXT = {
  not_started: "hadn’t started",
  ended: "had ended",
  in_progress: "was in progress",
} as const;

// Q16, H2: a request filed on a team's behalf, and what the commissioner attested for it.
export function FilingPanel({ filing }: { filing: OnBehalfFiling | null }) {
  if (filing === null) return null;
  return (
    <section className="rounded-[1.5rem] border border-white/8 bg-black/15 p-4 text-sm">
      <h3 className="text-base font-medium">Filed on the team’s behalf</h3>
      <ul className="mt-2 grid gap-1">
        <li>
          Manager asked: {formatReadTime(filing.statedMoment.toISOString())} · filed{" "}
          {formatReadTime(filing.filedAt.toISOString())}
        </li>
        <li>
          Attested designation: {filing.designation.toLowerCase()}
          {filing.designationAtFiling === null
            ? ""
            : ` (ESPN at filing: ${filing.designationAtFiling.toLowerCase()})`}
        </li>
        {filing.replacementGame === null ? null : (
          <li>Attested: the replacement’s game {GAME_TEXT[filing.replacementGame]}</li>
        )}
        {filing.enteredTenths === null ? null : (
          <li>
            Entered by hand: his points before the request, {formatTenths(filing.enteredTenths)}
          </li>
        )}
        {filing.note === null ? null : <li className="break-words">Note: {filing.note}</li>}
      </ul>
    </section>
  );
}
