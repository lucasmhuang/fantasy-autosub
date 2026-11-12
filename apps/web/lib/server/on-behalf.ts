import { toTenths } from "@injurysub/domain";
import type { LineupSlot } from "@injurysub/espn";
import { readTeamWeek } from "./board";
import { LEAGUE_TEAM_IDS } from "./commish-settings";
import { pacificDaysBetween, parsePacificMoment } from "./pacific-time";
import {
  type Attestation,
  parseSubmission,
  recordFiling,
  rosteredPlayer,
  type SubmitResult,
} from "./requests";

export type OnBehalfResult = SubmitResult | { status: "moment_outside_matchup" };

const GAME_STATES = ["not_started", "ended", "in_progress"] as const;
const POINTS = /^\d{1,3}(\.\d)?$/;
const MAX_NOTE_LENGTH = 500;

// The commissioner files a request a manager made outside the app, at the moment they state
// (Q16, Dec-D22). It's judged at that moment on the commissioner's attestation, never for their
// own team, and then follows the same gates as any request.
export async function fileOnBehalfRequest(input: {
  user: { userId: string; role: "manager" | "commissioner"; teamId: number | null };
  form: FormData;
  now: Date;
}): Promise<OnBehalfResult> {
  const { form, now } = input;
  const ids = parseSubmission(form);
  const teamId = Number(form.get("team"));
  const moment = parsePacificMoment(form.get("moment"));
  const attestation = parseAttestation(form);
  if (ids === null || !LEAGUE_TEAM_IDS.includes(teamId) || attestation === null) {
    return { status: "invalid_form" };
  }
  if (moment === null || moment.getTime() > now.getTime()) return { status: "invalid_form" };

  const read = await readTeamWeek(teamId);
  if ("status" in read) return { status: "espn_unreachable" };
  if (read.matchup === null) return { status: "no_matchup" };
  const injured = rosteredPlayer(read, ids.injuredId);
  const replacement = rosteredPlayer(read, ids.replacementId);
  if (injured === null || replacement === null) return { status: "not_on_team" };
  // ESPN's day changes at midnight Pacific: the moment's day is today's less the Pacific days
  // since.
  const requestDay = read.week.todayScoringPeriodId - pacificDaysBetween(moment, now);
  if (!read.week.scoringPeriodIds.includes(requestDay)) return { status: "moment_outside_matchup" };

  const filing = { kind: "on_behalf" as const, teamId, moment, requestDay, attestation };
  const { matchup } = read;
  return recordFiling(
    { user: input.user, now, ids, read, matchup, injured, replacement, filing },
    "on_behalf"
  );
}

// Hand-entered points are for a game in progress only (otherwise his line is observed), and
// need the note that backs them (a screenshot, say).
function parseAttestation(form: FormData): Attestation | null {
  const designation = form.get("designation");
  const replacementGame = GAME_STATES.find((state) => state === form.get("replacementGame"));
  const entered = String(form.get("enteredPoints") ?? "").trim();
  // A browser sends each line break as CRLF but counts it as one character against maxLength.
  const note = String(form.get("note") ?? "")
    .replaceAll("\r\n", "\n")
    .trim();
  if (designation !== "OUT" && designation !== "SUSPENSION") return null;
  if (replacementGame === undefined || note.length > MAX_NOTE_LENGTH) return null;
  if (entered === "") return attestationOf(designation, replacementGame, null, note);
  if (replacementGame !== "in_progress" || !POINTS.test(entered) || note === "") return null;
  return attestationOf(designation, replacementGame, toTenths(Number(entered)), note);
}

function attestationOf(
  designation: Attestation["designation"],
  replacementGame: Attestation["replacementGame"],
  enteredTenths: number | null,
  note: string
): Attestation {
  return { designation, replacementGame, enteredTenths, note: note === "" ? null : note };
}

export type FilingPlayer = { playerId: number; name: string; slot: string; designation: string };

export type FilingChoices =
  | { status: "not_connected" | "credentials_rejected" | "unavailable" | "no_matchup" }
  | { status: "found"; teamName: string; starters: FilingPlayer[]; bench: FilingPlayer[] };

// The team's starters and bench as ESPN has them now, for the commissioner to pick from. Any
// starter can be named: his designation at the stated moment is attested.
export async function loadFilingChoices(input: { teamId: number }): Promise<FilingChoices> {
  const read = await readTeamWeek(input.teamId);
  if ("status" in read) return read;
  if (read.matchup === null) return { status: "no_matchup" };
  return {
    status: "found",
    teamName: read.lineup.teamName,
    starters: read.lineup.starters.flatMap(filingPlayer),
    bench: read.lineup.bench.flatMap(filingPlayer),
  };
}

function filingPlayer({ slot, player }: LineupSlot): FilingPlayer[] {
  if (player === null) return [];
  const { status } = player.designation;
  return [{ playerId: player.playerId, name: player.name, slot, designation: status }];
}
