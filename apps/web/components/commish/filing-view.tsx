import { zoneLabel } from "@injurysub/domain";
import { Notice } from "@injurysub/ui";
import type { RequestStatusMessage } from "../../app/(app)/app/status-messages";
import { renderCommissionerStatus } from "../../app/(commish)/commish/status-messages";
import type { FilingLineup, FilingPage, FilingRosterRow } from "../../lib/server/filing";
import { boardRowProps } from "../board/board-row-props";
import { AddressStatusNotice } from "../board/status-notice";
import { statusText } from "./filing-copy";
import { type FilingChoice, FilingForm, TeamPicker } from "./filing-form";

type Found = Extract<FilingPage, { status: "found" }>;
type Reading = { zone: string; now: Date; idempotencyKey: string };

const OWN_TEAM_HINT = "File your own from your Team page.";

// The commissioner files for a manager who asked outside the app (FS-FILE-1 to -6): pick the
// team, then its players, the moment and what they attest about it.
export function FilingView(props: { page: Found; status: string | undefined } & Reading) {
  const { page } = props;
  const team = page.team;
  const lineup = team?.lineup ?? null;
  const hint =
    lineup?.status === "form"
      ? `Week ${lineup.week.number}${lineup.opponent === null ? "" : `, vs ${lineup.opponent}`}.`
      : OWN_TEAM_HINT;
  const teamName = team?.name ?? "That team";
  return (
    <div className="page form flow">
      <header className="titleblock">
        <h1 className="t-title">File for a manager</h1>
        <div className="sub">
          For a manager who asked you directly, by text say. Not for your own team.
        </div>
      </header>
      <AddressStatusNotice
        status={props.status}
        render={(status) => plainAnswer(status, teamName)}
      />
      <TeamPicker teams={page.teams} chosen={team?.teamId ?? null} hint={hint} />
      {team !== null && lineup !== null && (
        <TeamLineup team={team} lineup={lineup} reading={props} />
      )}
    </div>
  );
}

// The sentence a plain post (no script) came back with.
function plainAnswer(status: string | null, team: string): RequestStatusMessage | null {
  if (status === null) return null;
  const body = statusText(status, team);
  return body === null ? renderCommissionerStatus(status) : { body, tone: "danger" };
}

function TeamLineup(props: {
  team: NonNullable<Found["team"]>;
  lineup: FilingLineup;
  reading: Reading;
}) {
  const { team, lineup, reading } = props;
  const retry = { label: "Try again", href: `/commish/requests/new?team=${team.teamId}` };
  switch (lineup.status) {
    case "no_matchup":
      return (
        <Notice tone="info">{`${team.name} has a bye this week, so there's nothing to file against.`}</Notice>
      );
    case "espn_unreadable":
      return (
        <Notice tone="info" action={retry}>
          {`Can't read ESPN right now, so ${possessive(team.name)} lineup can't be shown.`}
        </Notice>
      );
    case "worker_down":
      return (
        <Notice tone="fail" action={retry}>
          {`InjurySub's swap runner didn't answer, so ${possessive(team.name)} lineup can't be shown.`}
        </Notice>
      );
    case "season_over":
      return <Notice tone="info">{"The season is over, so there's nothing to file."}</Notice>;
    default:
      return <FilingForm {...formProps(team, lineup, reading)} />;
  }
}

function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

function formProps(
  team: NonNullable<Found["team"]>,
  lineup: Extract<FilingLineup, { status: "form" }>,
  reading: Reading
) {
  const choice =
    (bench: boolean) =>
    ({ slot, player }: FilingRosterRow): FilingChoice => ({
      value: String(player.playerId),
      name: player.name,
      designation: player.designation,
      row: boardRowProps(player, slot, { bench, stale: false, zone: reading.zone, pill: true }),
    });
  return {
    copy: {
      manager: team.manager,
      team: team.name,
      zone: reading.zone,
      week: {
        number: lineup.week.number,
        firstDate: lineup.days.firstDate,
        lastDate: lineup.days.lastDate,
      },
    },
    teamId: team.teamId,
    zoneLabel: zoneLabel(reading.now, reading.zone),
    idempotencyKey: reading.idempotencyKey,
    readAt: lineup.readAt,
    starters: lineup.starters.map(choice(false)),
    bench: lineup.bench.map(choice(true)),
    days: lineup.days.options,
    chosenDay: lineup.days.chosen,
  };
}
