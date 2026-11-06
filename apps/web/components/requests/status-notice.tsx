import type { RequestStatusMessage } from "../../app/(app)/app/status-messages";

const TONES = {
  success: { borderColor: "rgba(136, 228, 159, 0.24)", color: "var(--success)" },
  danger: { borderColor: "rgba(255, 134, 125, 0.24)", color: "var(--danger)" },
  muted: { borderColor: "rgba(255, 255, 255, 0.1)", color: "var(--muted)" },
} as const;

export function StatusNotice({ status }: { status: RequestStatusMessage | null }) {
  if (status === null) return null;
  return (
    <div className="mt-6 rounded-2xl border px-4 py-3 text-sm leading-7" style={TONES[status.tone]}>
      {status.body}
    </div>
  );
}
