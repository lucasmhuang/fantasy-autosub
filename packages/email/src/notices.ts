import {
  formatMoment,
  type MisuseAlertKind,
  misuseAlertTitle,
  PACIFIC,
  slotLabel,
  teamName,
} from "@injurysub/domain";
import type { EmailFact, EmailRecord } from "./record";
import { surname } from "./record";

function pacificDate(at: Date): string {
  return formatMoment(at, PACIFIC, "date");
}

export type CredentialsRefusedEmailInput = {
  to: string;
  since: Date;
  // Requests queued or executing when the refusal began: their managers see them as delayed.
  waiting: number;
};

// "ESPN refused the cookie" (FS-EMAIL-12). One email per refusal; no separate paused email
// for it (IF-EMAIL-3), since nothing is read while the cookie is refused.
export function credentialsRefusedRecord(input: CredentialsRefusedEmailInput): EmailRecord {
  return {
    kind: "alert",
    subject: "ESPN refused the cookie",
    lead: "ESPN refused the league’s cookie, so InjurySub can’t read or write ESPN.",
    facts: [
      { label: "Since", value: pacificDate(input.since) },
      { label: "Waiting requests", value: input.waiting === 0 ? "None" : String(input.waiting) },
    ],
  };
}

export type WatchPausedEmailInput = {
  to: string;
  since: Date;
  // ESPN didn't answer, or refused the cookie on one of the watch's own reads (Revision 6 H).
  cause: "unreachable" | "refused";
};

// The subject says the watch is paused, so the first sentence is the cause alone.
const PAUSE_CAUSES = {
  unreachable: "InjurySub can’t reach ESPN.",
  refused: "ESPN refused the cookie.",
} as const;

// "Misuse watch is paused" (FS-EMAIL-13; IF-EMAIL-4, -6).
export function watchPausedRecord(input: WatchPausedEmailInput): EmailRecord {
  return {
    kind: "alert",
    subject: "Misuse watch is paused",
    lead: PAUSE_CAUSES[input.cause],
    facts: [{ label: "Since", value: pacificDate(input.since) }],
  };
}

export type MisuseAlertEmailInput = {
  to: string;
  alertId: string;
  kind: MisuseAlertKind;
  // Null for an alert about the whole league (a setting changed, the league turned public).
  teamId: number | null;
  teamName: string | null;
  espnAt: Date | null;
  foundAt: Date;
  // The worker's own sentence and undo steps, as the misuse watch page shows them.
  what: string;
  undo: readonly string[];
  // A lineup change's moves, by slot name; empty for every other kind.
  moves: readonly { name: string; fromSlot: string; toSlot: string }[];
};

// ESPN's time, or when it was seen if ESPN gave none. A lineup change's moves are the change and,
// reversed, its undo; every other alert's first sentence names the change, and its undo carries
// the value to restore.
function misuseFactsOf(input: MisuseAlertEmailInput): EmailFact[] {
  const onEspn: EmailFact = {
    label: "On ESPN",
    value: input.espnAt === null ? `Seen ${pacificDate(input.foundAt)}` : pacificDate(input.espnAt),
  };
  if (input.kind === "lm_transaction" && input.moves.length > 0) {
    const moves = input.moves
      .map(
        (move) => `${surname(move.name)} ${slotLabel(move.fromSlot)} → ${slotLabel(move.toSlot)}`
      )
      .join(", ");
    return [{ label: "Change", value: moves }, onEspn];
  }
  return [onEspn, { label: "To undo", value: input.undo.join(" ") }];
}

// "Misuse watch: {team}" (FS-EMAIL-14, -16).
export function misuseAlertRecord(input: MisuseAlertEmailInput): EmailRecord {
  const team =
    input.teamId === null
      ? (input.teamName ?? "the league")
      : teamName(input.teamId, input.teamName);
  const leagueWide = input.kind === "lm_league_change" || input.kind === "league_public";
  return {
    kind: "alert",
    subject: `Misuse watch: ${leagueWide ? "the league" : team}`,
    // The shared title, then the worker's sentence; a lineup change's moves are its Change row.
    lead:
      input.kind === "lm_transaction" && input.moves.length > 0
        ? `${misuseAlertTitle(input.kind, team)}. Made as league manager, not by InjurySub.`
        : `${misuseAlertTitle(input.kind, team)}. ${input.what}`,
    facts: misuseFactsOf(input),
  };
}
