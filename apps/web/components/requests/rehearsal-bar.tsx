import type { WorkerBar } from "../../lib/server/espn";
import { PRACTICE_BAR_TEXT, REHEARSAL_BAR_TEXT } from "./labels";
import { StatusNotice } from "./status-notice";

const BAR_TEXT = { rehearsal: REHEARSAL_BAR_TEXT, practice: PRACTICE_BAR_TEXT } as const;

// Shown on the board, Confirm and the proving page: the rehearsal bar while the worker only
// records its ESPN writes (S11), the practice bar while it sends them to its practice copy of ESPN.
export function RehearsalBar({ bar }: { bar: WorkerBar }) {
  return <StatusNotice status={bar === null ? null : { body: BAR_TEXT[bar], tone: "warning" }} />;
}
