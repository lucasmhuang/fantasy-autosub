import { Button } from "@injurysub/ui";
import { loadAutomationSwitch } from "../../lib/server/commish-alerts";
import { automationSwitchText } from "./automation-text";

// The off switch, on every commissioner page (O11): one tap, from a phone, with no redeploy.
export async function AutomationSwitch() {
  const { line, action } = automationSwitchText(await loadAutomationSwitch());
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span>{line}</span>
      {action === null ? null : (
        <form action={action.path} method="post">
          <Button type="submit" intent="ghost" size="sm">
            {action.label}
          </Button>
        </form>
      )}
    </div>
  );
}
