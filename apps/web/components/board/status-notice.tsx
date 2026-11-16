import { Notice, type NoticeTone } from "@injurysub/ui";
import {
  type RequestStatusMessage,
  renderRequestStatus,
} from "../../app/(app)/app/status-messages";

const TONES: Record<RequestStatusMessage["tone"], NoticeTone> = {
  success: "info",
  muted: "info",
  warning: "wait",
  danger: "fail",
};

// Answers where trying again can help: ESPN couldn't be checked, or something failed on our side.
const RETRYABLE: readonly string[] = ["espn_unreachable", "unavailable"];

// The answer a request route left in the address (`?status=`), as the system's notice; `retry`
// is where "Try again" goes, offered only where trying again can help (FM-CONFIRM-7).
export function AddressStatusNotice({
  status,
  retry,
}: {
  status: string | undefined;
  retry?: string;
}) {
  const message = renderRequestStatus(status ?? null);
  if (message === null) return null;
  const action =
    retry !== undefined && status !== undefined && RETRYABLE.includes(status)
      ? { label: "Try again", href: retry }
      : undefined;
  return (
    <Notice tone={TONES[message.tone]} action={action}>
      {message.body}
    </Notice>
  );
}
