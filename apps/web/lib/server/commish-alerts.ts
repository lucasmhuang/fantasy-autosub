import {
  acknowledgeMisuseAlert,
  describeFailure,
  getMisuseWatch,
  isDatabaseQueryError,
  type LeagueSettings,
  listAcknowledgedMisuseAlerts,
  listOpenMisuseAlerts,
  type MisuseAlertRecord,
  type MisuseWatchRecord,
  readLeagueSettings,
  switchAutomationOff,
  switchAutomationOn,
} from "@injurysub/db";
import type { LeagueExecutionMode, MisuseAlertKind } from "@injurysub/domain";
import { z } from "zod";
import { getWebDatabaseConnection } from "./db";
import { getWebLogger } from "./logger";

// An alert as the commissioner's alerts page shows it (M1, M4, M5, M10).
export type AlertEntry = {
  alertId: string;
  kind: MisuseAlertKind;
  teamName: string | null;
  espnAt: Date | null;
  // When InjurySub saw it.
  foundAt: Date;
  what: string;
  undo: string[];
  // The players a lineup change moved, by ESPN's name for each when it was read.
  players: { playerId: number; name: string | null }[];
  foundBeforeWatch: boolean;
  acknowledgedAt: Date | null;
  acknowledgedNote: string | null;
};

// Whether misuse detection is reading ESPN (M6): never started (no cookie on the worker yet),
// reading, or paused since a time, and why.
export type WatchState =
  | { state: "not_started" }
  | { state: "watching"; checkedAt: Date }
  | {
      state: "paused";
      reason: "credentials_rejected" | "unreachable" | "not_connected";
      since: Date;
      checkedAt: Date;
    };

// One of the commissioner team's moves of the last day (M9).
export type TeamMove = {
  at: Date;
  type: string;
  byLeagueManager: boolean;
  items: { type: string; player: string; fromSlot: string | null; toSlot: string | null }[];
};

export type AlertsPage =
  | { status: "unavailable" }
  | {
      status: "found";
      watch: WatchState;
      open: AlertEntry[];
      acknowledged: AlertEntry[];
      // As the watch's last reading pass found them; empty before its first.
      teamMoves: TeamMove[];
    };

// How many acknowledged alerts the page keeps listing, newest first.
const ACKNOWLEDGED_SHOWN = 20;

export async function loadAlertsPage(): Promise<AlertsPage> {
  try {
    const { db } = getWebDatabaseConnection();
    const watch = await getMisuseWatch(db);
    return {
      status: "found",
      watch: watchStateOf(watch),
      open: (await listOpenMisuseAlerts(db)).map(entryOf),
      acknowledged: (await listAcknowledgedMisuseAlerts(db, ACKNOWLEDGED_SHOWN)).map(entryOf),
      teamMoves: teamMovesOf(watch?.teamMoves),
    };
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "alerts");
    return { status: "unavailable" };
  }
}

// The misuse watch as its last check left it.
export function watchStateOf(watch: MisuseWatchRecord | null): WatchState {
  if (watch === null) return { state: "not_started" };
  if (watch.state === "working") return { state: "watching", checkedAt: watch.checkedAt };
  return { state: "paused", reason: watch.state, since: watch.since, checkedAt: watch.checkedAt };
}

const detailsSchema = z.object({ what: z.string(), undo: z.array(z.string()) });

function entryOf(alert: MisuseAlertRecord): AlertEntry {
  const details = detailsSchema.safeParse(alert.details);
  return {
    alertId: alert.alertId,
    kind: alert.kind,
    teamName: alert.teamName,
    espnAt: alert.espnAt,
    foundAt: alert.foundAt,
    what: details.success ? details.data.what : "An alert whose details can't be read.",
    undo: details.success ? details.data.undo : [],
    players: alert.players,
    foundBeforeWatch: alert.foundBeforeWatch,
    acknowledgedAt: alert.acknowledgedAt,
    acknowledgedNote: alert.acknowledgedNote,
  };
}

const teamMovesSchema = z.array(
  z.object({
    at: z.string().transform((value) => new Date(value)),
    type: z.string(),
    byLeagueManager: z.boolean(),
    items: z.array(
      z.object({
        type: z.string(),
        player: z.string(),
        fromSlot: z.string().nullable(),
        toSlot: z.string().nullable(),
      })
    ),
  })
);

function teamMovesOf(stored: unknown): TeamMove[] {
  const parsed = teamMovesSchema.safeParse(stored);
  return parsed.success ? parsed.data : [];
}

const ALERT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function acknowledgeAlertBy(input: {
  alertId: string;
  userId: string;
  now: Date;
}): Promise<{ status: "acknowledged" | "alert_not_found" | "unavailable" }> {
  if (!ALERT_ID.test(input.alertId)) return { status: "alert_not_found" };
  try {
    const acknowledged = await acknowledgeMisuseAlert(getWebDatabaseConnection().db, {
      alertId: input.alertId,
      userId: input.userId,
      at: input.now,
    });
    return { status: acknowledged === null ? "alert_not_found" : "acknowledged" };
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "acknowledge_alert");
    return { status: "unavailable" };
  }
}

// The off switch every commissioner page shows (O11, Dec-D31e): on, switched off from the pages
// (with what switching back on restores), or off in the settings, with no team to restore.
export type AutomationSwitchView =
  | { status: "unavailable" }
  | { status: "on"; mode: LeagueExecutionMode; teamCount: number }
  | { status: "switched_off"; mode: LeagueExecutionMode; teamCount: number }
  | { status: "off" };

// The automation line's state on a commissioner page, with when it was last switched.
export type PageAutomation =
  | (Exclude<AutomationSwitchView, { status: "unavailable" }> & { changedAt: Date | null })
  | { status: "unavailable" };

export async function loadAutomation(): Promise<PageAutomation> {
  try {
    const settings = await readLeagueSettings(getWebDatabaseConnection().db);
    return { ...automationSwitchOf(settings), changedAt: settings.automationChangedAt };
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "automation_switch");
    return { status: "unavailable" };
  }
}

// On while any team is ticked; switched off from the pages while a list waits to be restored;
// otherwise off in the settings.
export function automationSwitchOf(
  settings: LeagueSettings
): Exclude<AutomationSwitchView, { status: "unavailable" }> {
  const mode = settings.executionMode;
  if (settings.writeAllowlist.length > 0) {
    return { status: "on", mode, teamCount: settings.writeAllowlist.length };
  }
  if (settings.allowlistBeforeOff !== null) {
    return { status: "switched_off", mode, teamCount: settings.allowlistBeforeOff.length };
  }
  return { status: "off" };
}

// The commissioner pages a switch can be used on: its answer comes back to the one it was on,
// anything else to the queue (Revision 4, C).
const SWITCH_PAGES =
  /^\/commish\/(requests(\/new|\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?|settings|proving|alerts)$/;

export function switchAnswerPage(from: FormDataEntryValue | null): string {
  return typeof from === "string" && SWITCH_PAGES.test(from) ? from : "/commish/requests";
}

export async function switchAutomationBy(input: {
  on: boolean;
  actorUserId: string;
  now: Date;
}): Promise<{
  status:
    | "automation_switched_off"
    | "automation_switched_on"
    | "automation_unchanged"
    | "unavailable";
}> {
  const change = { updatedBy: input.actorUserId, now: input.now };
  try {
    const { db } = getWebDatabaseConnection();
    const switched = input.on
      ? await switchAutomationOn(db, change)
      : await switchAutomationOff(db, change);
    if (!switched) return { status: "automation_unchanged" };
    getWebLogger().info("web.commish.automation_switched", { on: input.on });
    return { status: input.on ? "automation_switched_on" : "automation_switched_off" };
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "switch_automation");
    return { status: "unavailable" };
  }
}

function logFailure(error: unknown, flow: string): void {
  getWebLogger().error("web.commish.database_failed", undefined, {
    flow,
    reason: describeFailure(error),
  });
}
