import { cn } from "../lib/cn";

export type AutomationLineProps = {
  on: boolean;
  // On: the mode and team count ("approval required, 12 teams"). Off: "every request comes to you".
  detail: string;
  // Where the switch posts: the route that turns automation the other way.
  action: string;
  id?: string;
};

// The commissioner's automation state and its off switch, under every commissioner page's
// title. The switch is drawn 32 px tall; its pseudo-element makes the touch target 44.
export function AutomationLine({
  on,
  detail,
  action,
  id = "automation-label",
}: AutomationLineProps) {
  return (
    <div className={cn("autostrip", !on && "is-off")}>
      <div className="lbl" id={id}>
        Automation {on ? "on" : "off"} <span className="sub">· {detail}</span>
      </div>
      <form method="post" action={action}>
        <button
          className="switch before:absolute before:-inset-y-(--space-6) before:inset-x-0 before:content-['']"
          type="submit"
          role="switch"
          aria-checked={on}
          aria-labelledby={id}
        />
      </form>
    </div>
  );
}
