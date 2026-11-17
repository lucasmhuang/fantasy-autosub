import { formatMoment, type MisuseAlertKind, PACIFIC } from "@injurysub/domain";
import type { EmailRecord } from "./record";
import { surname } from "./record";

const FOOT = [
  "Sent to you as the league’s commissioner on InjurySub.",
  "Not affiliated with ESPN or the NBA.",
];

function pacificDate(at: Date): string {
  return formatMoment(at, PACIFIC, "date");
}

export type CredentialsRefusedEmailInput = {
  to: string;
  since: Date;
  // Requests queued or executing when the refusal began: their managers see them as delayed.
  waiting: number;
  expiryHours: number;
};

// "ESPN refused InjurySub's access" (FS-EMAIL-12). One email per refusal, which also says the
// misuse watch is paused: no separate paused email for it (IF-EMAIL-3).
export function credentialsRefusedRecord(input: CredentialsRefusedEmailInput): EmailRecord {
  return {
    kind: "alert",
    subject: "ESPN refused InjurySub’s access",
    lead: "ESPN refused the league’s ESPN cookie, so InjurySub has stopped reading from and writing to ESPN.",
    facts: [
      { label: "Since", value: pacificDate(input.since) },
      {
        label: "Waiting requests",
        value:
          input.waiting === 0 ? "None" : `${input.waiting}, shown to their managers as delayed`,
      },
      { label: "Misuse watch", value: "Paused until ESPN accepts a new cookie" },
    ],
    body: [
      `Once ESPN accepts a new cookie, InjurySub re-checks each waiting request before sending anything. Any request older than ${input.expiryHours} hours comes to you instead.`,
    ],
    action: "Renew the ESPN cookie on the host.",
    foot: FOOT,
  };
}

export type WatchPausedEmailInput = {
  to: string;
  since: Date;
  // ESPN didn't answer, or refused the cookie on one of the watch's own reads (Revision 6 H).
  cause: "unreachable" | "refused";
};

const PAUSE_CAUSES = {
  unreachable: { opening: "InjurySub can’t reach ESPN, so it", why: "ESPN can’t be reached" },
  refused: {
    opening: "ESPN refused InjurySub’s access, so InjurySub",
    why: "ESPN refused InjurySub’s access",
  },
} as const;

// "Misuse watch is paused" (FS-EMAIL-13; IF-EMAIL-4, -6).
export function watchPausedRecord(input: WatchPausedEmailInput): EmailRecord {
  const cause = PAUSE_CAUSES[input.cause];
  return {
    kind: "alert",
    subject: "Misuse watch is paused",
    lead: `${cause.opening} isn’t checking the league for changes it didn’t make.`,
    facts: [
      { label: "Since", value: pacificDate(input.since) },
      { label: "Why", value: cause.why },
    ],
    body: [
      "Until it’s back, a quiet inbox doesn’t mean nothing happened on ESPN. The watch starts again once ESPN answers.",
    ],
    action: "Nothing to do unless you see a change on ESPN you didn’t make.",
    foot: FOOT,
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

// The kind's title, as the misuse watch page words it (`apps/web/components/commish/alerts-copy.ts`).
const KIND_TITLES: Record<MisuseAlertKind, (team: string) => string> = {
  lm_transaction: (team) => `Lineup change on ${team}`,
  lm_adjustment: (team) => `Score adjustment on ${team}`,
  lm_league_change: () => "League setting changed",
  adjustment_mismatch: (team) => `Adjustment differs on ${team}`,
  league_public: () => "The league turned public",
};

function slotName(slot: string): string {
  return slot === "BE" ? "BN" : slot;
}

function changeOf(input: MisuseAlertEmailInput, team: string): string {
  if (input.kind === "lm_transaction" && input.moves.length > 0) {
    return input.moves
      .map((move) => `${surname(move.name)} ${slotName(move.fromSlot)} → ${slotName(move.toSlot)}`)
      .join(", ");
  }
  return KIND_TITLES[input.kind](team);
}

// "{date} (seen {time})", the seen time dated when it falls on another day; "Seen {date}" when
// ESPN gave no time.
function onEspnOf(input: MisuseAlertEmailInput): string {
  const seen = pacificDate(input.foundAt);
  if (input.espnAt === null) return `Seen ${seen}`;
  const espn = pacificDate(input.espnAt);
  const sameDay = espn.split(",")[0] === seen.split(",")[0];
  return `${espn} (seen ${sameDay ? formatMoment(input.foundAt, PACIFIC, "time") : seen})`;
}

// "Misuse watch: {team}" (FS-EMAIL-14, -16).
export function misuseAlertRecord(input: MisuseAlertEmailInput): EmailRecord {
  const team = input.teamName ?? (input.teamId === null ? "the league" : `Team ${input.teamId}`);
  const leagueWide = input.kind === "lm_league_change" || input.kind === "league_public";
  return {
    kind: "alert",
    subject: `Misuse watch: ${leagueWide ? "the league" : team}`,
    lead:
      input.kind === "lm_transaction"
        ? `Someone made a league-manager lineup change on ${team} that InjurySub didn’t make.`
        : input.what,
    facts: [
      { label: "Change", value: changeOf(input, team) },
      { label: "On ESPN", value: onEspnOf(input) },
      { label: "To undo", value: input.undo.join(" ") },
    ],
    action: "Undo it on ESPN, or acknowledge it in InjurySub’s misuse watch if you made it.",
    note: "Removing InjurySub’s copy of the ESPN cookie doesn’t stop the cookie working.",
    foot: FOOT,
  };
}
