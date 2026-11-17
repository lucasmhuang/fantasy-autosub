/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { EmailLayout } from "../src/layout";
import { type WatchPausedEmailInput, watchPausedRecord } from "../src/notices";

export default function PausedUnreachablePreview(input: WatchPausedEmailInput) {
  return <EmailLayout record={watchPausedRecord(input)} />;
}

PausedUnreachablePreview.PreviewProps = {
  to: "commissioner@example.test",
  since: new Date("2026-11-13T18:12:00.000Z"),
  cause: "unreachable",
} satisfies WatchPausedEmailInput;
