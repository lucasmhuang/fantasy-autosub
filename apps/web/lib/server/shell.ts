import {
  countWaitingOnCommissioner,
  describeFailure,
  findActiveCommissioner,
  findTeamName,
  isDatabaseQueryError,
} from "@injurysub/db";
import { teamName } from "@injurysub/domain";
import { getWebDatabaseConnection } from "./db";
import { readWorkerBar, type WorkerBar } from "./espn";
import { getWebLogger } from "./logger";

export type ShellAccount = { initial: string; email: string; team: string | null };

// What every signed-in page's shell shows: who is signed in, the commissioner's Queue count,
// the worker's bar, and the zone this device last reported.
export type ShellData = {
  account: ShellAccount;
  commissioner: boolean;
  // The league's commissioner as the pages name them (FS-APP-9); null when unread or none.
  commissionerName: string | null;
  // Requests and misuse alerts waiting on the commissioner; null for a manager, or unread.
  waiting: number | null;
  bar: WorkerBar;
  zone: string | null;
};

// The parts of a signed-in session the shell reads.
export type ShellSession = {
  user: {
    role: "manager" | "commissioner";
    displayName: string;
    email: string;
    teamId: number | null;
  };
  session: { timeZone: string | null };
};

// Loaded beside each page's own loader. Neither read can fail the page: a count that can't be
// read shows no badge, and a worker that doesn't answer within 2 s shows no bar.
export async function loadShell(session: ShellSession): Promise<ShellData> {
  const { user } = session;
  const commissioner = user.role === "commissioner";
  const [waiting, bar, commissionerName, storedTeamName] = await Promise.all([
    commissioner ? readWaitingCount() : Promise.resolve(null),
    readWorkerBar(),
    readCommissionerName(),
    user.teamId === null ? Promise.resolve(null) : readStoredTeamName(user.teamId),
  ]);
  return {
    account: {
      initial: (user.displayName.trim()[0] ?? user.email[0] ?? "?").toUpperCase(),
      email: user.email,
      team: user.teamId === null ? null : teamName(user.teamId, storedTeamName),
    },
    commissioner,
    commissionerName,
    waiting,
    bar,
    zone: session.session.timeZone,
  };
}

async function readWaitingCount(): Promise<number | null> {
  try {
    return await countWaitingOnCommissioner(getWebDatabaseConnection().db);
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    getWebLogger().error("web.shell.count_unread", undefined, { reason: describeFailure(error) });
    return null;
  }
}

// The team's name as the worker last stored it (FS-APP-14); its number when unread.
async function readStoredTeamName(teamId: number): Promise<string | null> {
  try {
    return await findTeamName(getWebDatabaseConnection().db, teamId);
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    getWebLogger().error("web.shell.team_name_unread", undefined, {
      reason: describeFailure(error),
    });
    return null;
  }
}

async function readCommissionerName(): Promise<string | null> {
  try {
    return (await findActiveCommissioner(getWebDatabaseConnection().db))?.displayName ?? null;
  } catch (error) {
    if (!isDatabaseQueryError(error)) throw error;
    getWebLogger().error("web.shell.commissioner_unread", undefined, {
      reason: describeFailure(error),
    });
    return null;
  }
}
