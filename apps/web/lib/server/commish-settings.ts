import { loadServerEnv } from "@injurysub/config";
import {
  describeFailure,
  isDatabaseQueryError,
  type LeagueSettings,
  readLeagueSettings,
  writeLeagueSettings,
} from "@injurysub/db";
import { type LeagueExecutionMode, leagueExecutionModes } from "@injurysub/domain";
import { type NextRequest, NextResponse } from "next/server";
import { commissionerAccess, refuseCrossSitePost, sessionFromRequest } from "./auth";
import { getWebDatabaseConnection } from "./db";
import { getWebLogger } from "./logger";

// The league's twelve teams, numbered as ESPN numbers them.
export const LEAGUE_TEAM_IDS = Array.from({ length: 12 }, (_, index) => index + 1);

export type SettingsView =
  | { status: "unavailable" }
  | { status: "found"; settings: LeagueSettings };

export async function loadSettings(): Promise<SettingsView> {
  try {
    return { status: "found", settings: await readLeagueSettings(getWebDatabaseConnection().db) };
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "settings");
    return { status: "unavailable" };
  }
}

// Q1, Q2, O11: the execution mode and the teams the worker may write for; no team means
// automation is off. Requests confirmed afterwards follow the new settings.
export async function saveSettings(input: {
  actorUserId: string;
  form: FormData;
  now: Date;
}): Promise<{ status: "saved" | "invalid_form" | "unavailable" }> {
  const mode = input.form.get("executionMode");
  const teams = input.form.getAll("team").map(Number);
  if (!isExecutionMode(mode) || !teams.every((team) => LEAGUE_TEAM_IDS.includes(team))) {
    return { status: "invalid_form" };
  }
  try {
    await writeLeagueSettings(getWebDatabaseConnection().db, {
      executionMode: mode,
      writeAllowlist: [...new Set(teams)].sort((a, b) => a - b),
      updatedBy: input.actorUserId,
      now: input.now,
    });
    getWebLogger().info("web.commish.settings_saved", { executionMode: mode, teams });
    return { status: "saved" };
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    logFailure(error, "save_settings");
    return { status: "unavailable" };
  }
}

function isExecutionMode(value: unknown): value is LeagueExecutionMode {
  return typeof value === "string" && (leagueExecutionModes as readonly string[]).includes(value);
}

// For a commissioner's form POST: the commissioner's user id, or the response refusing anyone
// else (Q14): another site, no session (to sign in), or a manager (403).
export async function commissionerFromPost(
  request: NextRequest,
  now: Date,
  signInPath: string
): Promise<{ userId: string; teamId: number | null } | Response> {
  const refusal = refuseCrossSitePost(request);
  if (refusal) return refusal;
  const session = await sessionFromRequest(request, now);
  const access = commissionerAccess(session);
  if (access === "sign_in" || session === null) {
    return redirectTo(`/login?redirect=${encodeURIComponent(signInPath)}`);
  }
  if (access === "not_commissioner") {
    return new NextResponse("Only the commissioner can do this.", { status: 403 });
  }
  return { userId: session.user.userId, teamId: session.user.teamId };
}

// On the app's own address: behind the host's proxy, request.url is the server's internal one.
export function redirectTo(path: string): Response {
  return NextResponse.redirect(new URL(path, loadServerEnv().APP_BASE_URL), { status: 303 });
}

function logFailure(error: unknown, flow: string): void {
  getWebLogger().error("web.commish.database_failed", undefined, {
    flow,
    reason: describeFailure(error),
  });
}
