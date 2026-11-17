import { cn } from "../lib/cn";

export type AutomationLineProps = {
  // On or off; omitted with `unread`, when the settings couldn't be read.
  on?: boolean;
  unread?: boolean;
  // On: the mode and team count ("approval required, 12 teams"). Off: "every request comes to you".
  detail: string;
  // Where the switch posts: the route that turns automation the other way. None when switching
  // has nothing to restore (off in Settings): the line has no switch.
  action?: string;
  // The page the switch is on, posted so its answer comes back there.
  from?: string;
  id?: string;
};

// The commissioner's automation state and its off switch, under every commissioner page's
// title. The switch is drawn 32 px tall; its pseudo-element makes the touch target 44.
export function AutomationLine({
  on = false,
  unread = false,
  detail,
  action,
  from,
  id = "automation-label",
}: AutomationLineProps) {
  const state = unread ? "" : on ? " on" : " off";
  return (
    <div className={cn("autostrip", (!on || unread) && "is-off")}>
      <div className="lbl" id={id}>
        {`Automation${state} `}
        <span className="sub">· {detail}</span>
      </div>
      {action && !unread && (
        <form method="post" action={action}>
          {from && <input type="hidden" name="from" value={from} />}
          <button
            className="switch before:absolute before:-inset-y-(--space-6) before:inset-x-0 before:content-['']"
            type="submit"
            role="switch"
            aria-checked={on}
            aria-labelledby={id}
          />
        </form>
      )}
    </div>
  );
}
