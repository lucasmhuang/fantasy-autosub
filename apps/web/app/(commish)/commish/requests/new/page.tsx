import { randomUUID } from "node:crypto";
import { Button } from "@injurysub/ui";
import { redirect } from "next/navigation";
import { CommishHeader } from "../../../../../components/commish/commish-header";
import { NO_BOARD_TEXT } from "../../../../../components/requests/labels";
import { StatusNotice } from "../../../../../components/requests/status-notice";
import { Surface } from "../../../../../components/shell/site-shell";
import { commissionerAccess, getCurrentAuthenticatedSession } from "../../../../../lib/server/auth";
import { LEAGUE_TEAM_IDS } from "../../../../../lib/server/commish-settings";
import { type FilingChoices, loadFilingChoices } from "../../../../../lib/server/on-behalf";
import { renderCommissionerStatus } from "../../status-messages";

const inputClassName =
  "rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition focus:border-[color:var(--accent)]";

// The commissioner files a request a manager made outside the app (Q16): pick the team, then the
// players, the moment and what they attest about it.
export default async function FileRequestPage(props: {
  searchParams: Promise<{ team?: string; status?: string }>;
}) {
  const session = await getCurrentAuthenticatedSession();
  const access = commissionerAccess(session);
  if (access === "sign_in" || session === null) redirect("/login?redirect=/commish/requests/new");
  if (access === "not_commissioner") redirect("/app");
  const params = await props.searchParams;
  const ownTeam = session.user.teamId;
  const teams = LEAGUE_TEAM_IDS.filter((team) => team !== ownTeam);
  const team = teams.find((each) => String(each) === params.team) ?? null;
  const choices = team === null ? null : await loadFilingChoices({ teamId: team });

  return (
    <main className="page-shell">
      <div className="page-inner flex flex-col gap-6">
        <Surface className="rounded-[2rem] p-6 sm:p-8">
          <CommishHeader title="File on a team’s behalf" hasTeam={ownTeam !== null} />
          <StatusNotice status={renderCommissionerStatus(params.status ?? null)} />
          <TeamPicker teams={teams} chosen={team} />
          {team === null || choices === null ? null : <FilingBody team={team} choices={choices} />}
        </Surface>
      </div>
    </main>
  );
}

function TeamPicker({ teams, chosen }: { teams: number[]; chosen: number | null }) {
  return (
    <form method="get" className="mt-6 flex flex-wrap items-end gap-2 text-sm">
      <label className="flex flex-col gap-1">
        <span>Team</span>
        <select name="team" defaultValue={chosen ?? ""} className={inputClassName}>
          {teams.map((team) => (
            <option key={team} value={team}>
              Team {team}
            </option>
          ))}
        </select>
      </label>
      <Button intent="ghost" size="sm" type="submit">
        Show players
      </Button>
    </form>
  );
}

function FilingBody({ team, choices }: { team: number; choices: FilingChoices }) {
  if (choices.status === "no_matchup") {
    return <Muted text="That team has no matchup this week." />;
  }
  if (choices.status !== "found") return <Muted text={NO_BOARD_TEXT[choices.status]} />;
  return (
    <form
      action="/commish/requests/file"
      method="post"
      className="mt-6 flex flex-col gap-4 text-sm"
    >
      <input type="hidden" name="team" value={team} />
      <input type="hidden" name="idempotencyKey" value={randomUUID()} />
      <PlayerSelect name="injured" label="Injured starter" players={choices.starters} />
      <PlayerSelect name="replacement" label="Replacement from the bench" players={choices.bench} />
      <label className="flex flex-col gap-1">
        <span>When the manager asked (Pacific time)</span>
        <input className={inputClassName} type="datetime-local" name="moment" required />
      </label>
      <AttestationFields />
      <Button type="submit" className="self-start">
        File the request
      </Button>
    </form>
  );
}

function PlayerSelect(props: {
  name: string;
  label: string;
  players: { playerId: number; name: string; slot: string; designation: string }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span>{props.label}</span>
      <select name={props.name} className={inputClassName} required>
        {props.players.map((player) => (
          <option key={player.playerId} value={player.playerId}>
            {player.name} ({player.slot}, {player.designation.toLowerCase()})
          </option>
        ))}
      </select>
    </label>
  );
}

// What the commissioner attests for that moment: the starter's designation and where the
// replacement's game stood; mid-game, his points before the request with a note backing them.
function AttestationFields() {
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1">The starter at that moment was</legend>
        <Radio name="designation" value="OUT" label="OUT" checked />
        <Radio name="designation" value="SUSPENSION" label="Suspended" />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1">The replacement’s game at that moment</legend>
        <Radio name="replacementGame" value="not_started" label="Hadn’t started" checked />
        <Radio name="replacementGame" value="ended" label="Had ended" />
        <Radio name="replacementGame" value="in_progress" label="Was in progress" />
      </fieldset>
      <label className="flex flex-col gap-1">
        <span>If in progress: his points before the request</span>
        <input className={inputClassName} name="enteredPoints" inputMode="decimal" />
      </label>
      <label className="flex flex-col gap-1">
        <span>Note backing those points (a screenshot, say)</span>
        <textarea className={inputClassName} name="note" maxLength={500} rows={2} />
      </label>
    </>
  );
}

function Radio(props: { name: string; value: string; label: string; checked?: boolean }) {
  return (
    <label className="flex items-center gap-2">
      <input type="radio" name={props.name} value={props.value} defaultChecked={props.checked} />
      <span>{props.label}</span>
    </label>
  );
}

function Muted({ text }: { text: string }) {
  return <p className="mt-6 text-sm text-[color:var(--muted)]">{text}</p>;
}
