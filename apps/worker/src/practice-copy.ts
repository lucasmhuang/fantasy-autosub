import { AppError, type Logger } from "@injurysub/config";
import { type DatabaseExecutor, listVerifiedWrites } from "@injurysub/db";
import { type FakeEspn, FakeEspnUnappliableError } from "./fake-espn";
import { WorkerStartupError } from "./startup-error";

const RESET_HINT =
  "the practice copy can't replay the database's verified ESPN writes on its seed (were the recordings or the scenario changed?): run pnpm practice:reset";

// The database holds a verified write the copy's seed can't take, so the copy can't follow it.
export class PracticeCopyUnreplayableError extends AppError {
  override readonly name = "PracticeCopyUnreplayableError";
}

export type PracticeCopy = {
  sync(db: DatabaseExecutor): Promise<{ rebuilt: boolean; writes: number }>;
};

// A practice worker's copy of ESPN, kept a function of the database: its seed, then each verified
// write in the order sent, so the board never contradicts the requests it shows. Rebuilt at the
// first sync (a restart starts from the seed) and whenever the verified writes differ from the
// ones it was last built from: a reset took some away, or a write was verified since, by this
// worker or another during a deploy's overlap. A write sent but not read back isn't one of them;
// recovery's readback against the copy decides it, as on real ESPN.
export function createPracticeCopy(fake: FakeEspn): PracticeCopy {
  let builtFrom: readonly string[] | null = null;
  return {
    async sync(db) {
      const writes = await listVerifiedWrites(db);
      const ids = writes.map((write) => write.writeId);
      if (builtFrom !== null && sameIds(builtFrom, ids)) {
        return { rebuilt: false, writes: ids.length };
      }
      try {
        await fake.rebuild(writes);
      } catch (error) {
        if (!(error instanceof FakeEspnUnappliableError)) throw error;
        throw new PracticeCopyUnreplayableError(RESET_HINT, { cause: error });
      }
      builtFrom = ids;
      return { rebuilt: true, writes: ids.length };
    },
  };
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

// At startup: a copy that can't follow the database stops the worker before it's ready, naming the
// fix, so the deployment fails its healthcheck and the old one keeps running.
export async function syncPracticeCopyAtStart(
  copy: PracticeCopy,
  db: DatabaseExecutor,
  logger: Logger
): Promise<void> {
  try {
    await syncAndLog(copy, db, logger);
  } catch (error) {
    if (!(error instanceof PracticeCopyUnreplayableError)) throw error;
    throw new WorkerStartupError(`The worker can't start: ${RESET_HINT}.`, { cause: error });
  }
}

// Before each executor pass: whether the pass may run. While the copy can't follow the database,
// no pass runs on it (a stale copy would plan against a lineup the requests have changed), and
// the reason is logged once until a sync works again.
export function createPassSync(copy: PracticeCopy, logger: Logger) {
  let failing = false;
  return async (db: DatabaseExecutor): Promise<boolean> => {
    try {
      await syncAndLog(copy, db, logger);
      failing = false;
      return true;
    } catch (error) {
      if (!(error instanceof PracticeCopyUnreplayableError)) throw error;
      if (!failing) logger.error("worker.practice.copy_unreplayable", error);
      failing = true;
      return false;
    }
  };
}

async function syncAndLog(copy: PracticeCopy, db: DatabaseExecutor, logger: Logger) {
  const { rebuilt, writes } = await copy.sync(db);
  if (rebuilt) logger.info("worker.practice.copy_rebuilt", { writes });
}
