import type { RequestStatusMessage } from "../../app/(app)/app/status-messages";

const TONES = {
  success: {
    borderColor: "color-mix(in srgb, var(--success) 24%, transparent)",
    color: "var(--success)",
  },
  danger: {
    borderColor: "color-mix(in srgb, var(--danger) 24%, transparent)",
    color: "var(--danger)",
  },
  warning: {
    borderColor: "color-mix(in srgb, var(--warning) 24%, transparent)",
    color: "var(--warning)",
  },
  muted: { borderColor: "var(--line)", color: "var(--muted)" },
} as const;

export function StatusNotice({ status }: { status: RequestStatusMessage | null }) {
  if (status === null) return null;
  return (
    <div className="mt-6 rounded-2xl border px-4 py-3 text-sm leading-7" style={TONES[status.tone]}>
      {status.body}
    </div>
  );
}
