import { countWaitingOnCommissioner, describeFailure, isDatabaseQueryError } from "@injurysub/db";
import { getWebDatabaseConnection } from "./db";
import { readWorkerBar, type WorkerBar } from "./espn";
import { getWebLogger } from "./logger";

export type ShellAccount = { initial: string; email: string; team: string | null };

// What every signed-in page's shell shows: who is signed in, the commissioner's Queue count,
// the worker's bar, and the zone this device last reported.
export type ShellData = {
  account: ShellAccount;
  commissioner: boolean;
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
  const [waiting, bar] = await Promise.all([
    commissioner ? readWaitingCount() : Promise.resolve(null),
    readWorkerBar(),
  ]);
  return {
    account: {
      initial: (user.displayName.trim()[0] ?? user.email[0] ?? "?").toUpperCase(),
      email: user.email,
      team: user.teamId === null ? null : `Team ${user.teamId}`,
    },
    commissioner,
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
