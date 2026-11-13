import { REHEARSAL_BAR_TEXT } from "./labels";
import { StatusNotice } from "./status-notice";

// Shown on the board and on Confirm while the worker only records its ESPN writes (S11).
export function RehearsalBar({ rehearsal }: { rehearsal: boolean }) {
  return <StatusNotice status={rehearsal ? { body: REHEARSAL_BAR_TEXT, tone: "warning" } : null} />;
}
