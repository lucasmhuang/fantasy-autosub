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

// The answer a request route left in the address (`?status=`), as the system's notice.
export function AddressStatusNotice({ status }: { status: string | undefined }) {
  const message = renderRequestStatus(status ?? null);
  if (message === null) return null;
  return <Notice tone={TONES[message.tone]}>{message.body}</Notice>;
}
