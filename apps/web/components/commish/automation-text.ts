import type { LeagueExecutionMode } from "@injurysub/domain";
import type { AutomationSwitchView } from "../../lib/server/commish-alerts";

const MODE_NAMES: Record<LeagueExecutionMode, string> = {
  approval_required: "approval required",
  auto: "auto",
};

function teams(count: number): string {
  return count === 1 ? "1 team" : `${count} teams`;
}

// What the off switch says, on every commissioner page (O11, Dec-D31e).
export function automationSwitchText(view: AutomationSwitchView): {
  line: string;
  action: { path: string; label: string } | null;
} {
  switch (view.status) {
    case "on":
      return {
        line: `Automation is on: ${MODE_NAMES[view.mode]} for ${teams(view.teamCount)}.`,
        action: { path: "/commish/automation/off", label: "Turn automation off" },
      };
    case "switched_off":
      return {
        line: `Automation is off. Switching it back on restores ${MODE_NAMES[view.mode]} for ${teams(view.teamCount)}.`,
        action: { path: "/commish/automation/on", label: "Turn automation back on" },
      };
    case "off":
      return { line: "Automation is off: no team is checked in the settings.", action: null };
    case "unavailable":
      return { line: "Whether automation is on can't be shown right now.", action: null };
  }
}
