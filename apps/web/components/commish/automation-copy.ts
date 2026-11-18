import { formatRecentMoment, type LeagueExecutionMode } from "@injurysub/domain";
import type { PageAutomation } from "../../lib/server/commish-alerts";

type Reading = { zone: string; now: Date };

const MODE_NAMES: Record<LeagueExecutionMode, string> = {
  approval_required: "approval required",
  auto: "auto",
};

function teamCountText(count: number): string {
  return count === 1 ? "1 team" : `${count} teams`;
}

const OFF_NOTICE = "Requests in line stop before anything is sent and go to Needs you.";

// The automation line under every commissioner page's title and, while it's off, the notice under
// it (FS-SHELL-7, IF-SHELL-5). No switch while no team is ticked, since switching on would restore
// nothing, nor while the settings can't be read (Revision 4, B and D).
export function automationWords(
  automation: PageAutomation,
  reading: Reading
): {
  on: boolean;
  unread?: true;
  detail: string;
  action: string | undefined;
  notice: string | null;
} {
  if (automation.status === "unavailable") {
    return {
      on: false,
      unread: true,
      detail: "can't be read right now",
      action: undefined,
      notice: null,
    };
  }
  if (automation.status === "on") {
    return {
      on: true,
      detail: `${MODE_NAMES[automation.mode]}, ${teamCountText(automation.teamCount)}`,
      action: "/commish/automation/off",
      notice: null,
    };
  }
  const turnedOff =
    automation.changedAt === null
      ? ""
      : `Turned off ${formatRecentMoment(automation.changedAt, reading.zone, reading.now)}. `;
  return {
    on: false,
    detail: "every request goes to Needs you",
    action: automation.status === "switched_off" ? "/commish/automation/on" : undefined,
    notice: `${turnedOff}${OFF_NOTICE}`,
  };
}

// What switching back on restores, near the switch on Settings (FS-SETTINGS-6).
export function restoreHint(automation: PageAutomation): string | null {
  if (automation.status !== "switched_off") return null;
  return `Switching it back on restores ${MODE_NAMES[automation.mode]} for ${teamCountText(automation.teamCount)}.`;
}
