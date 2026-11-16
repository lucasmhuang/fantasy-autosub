import { type DatabaseExecutor, listVerifiedWrites } from "@injurysub/db";
import type { FakeEspn } from "./fake-espn";

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
      await fake.rebuild(writes);
      builtFrom = ids;
      return { rebuilt: true, writes: ids.length };
    },
  };
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
