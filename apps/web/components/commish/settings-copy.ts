import { formatMoment, formatRecentMoment } from "@injurysub/domain";

type Reading = { zone: string; now: Date };

// The settings page's own answers, naming the stored save's time (Revision 4, H): saved
// (IF-SETTINGS-1), or changed in another tab (FM-SETTINGS-1). Null leaves a status to the
// commissioner's own messages.
export function settingsNotice(
  status: string | undefined,
  updatedAt: Date | null,
  reading: Reading
): { tone: "info" | "wait"; text: string } | null {
  const when = updatedAt === null ? null : formatRecentMoment(updatedAt, reading.zone, reading.now);
  if (status === "saved")
    return { tone: "info", text: when === null ? "Saved." : `Saved ${when}.` };
  if (status !== "settings_changed") return null;
  const at = when === null ? "" : ` at ${when}`;
  return {
    tone: "wait",
    text: `Settings changed in another tab${at}; make your change again.`,
  };
}

// FS-SETTINGS-5: proving on the commissioner's own team.
export function provingText(doneAt: Date | null, zone: string): string {
  if (doneAt === null) return "Not done. Run it once before ticking other teams.";
  return `Done ${formatMoment(doneAt, zone, "date")}.`;
}
