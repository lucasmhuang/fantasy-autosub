import { AutomationLine, Notice } from "@injurysub/ui";
import type { PageAutomation } from "../../lib/server/commish-alerts";
import { automationWords } from "./automation-copy";

type Reading = { zone: string; now: Date };

// The automation line and, while it's off, the notice under it (FS-SHELL-7, IF-SHELL-5); the
// switch posts the page it's on, so its answer comes back there (Revision 4, C).
export function AutomationStrip(props: { automation: PageAutomation; from: string } & Reading) {
  const words = automationWords(props.automation, props);
  return (
    <>
      <AutomationLine
        on={words.on}
        unread={words.unread}
        detail={words.detail}
        action={words.action}
        from={props.from}
      />
      {words.notice && <Notice tone="info">{words.notice}</Notice>}
    </>
  );
}

// A commissioner page's title, its line under it (Revision 4, A).
export function CommishTitle(
  props: { title: string; sub?: string; automation: PageAutomation; from: string } & Reading
) {
  return (
    <>
      <header className="titleblock">
        <h1 className="t-title">{props.title}</h1>
        {props.sub && <div className="sub">{props.sub}</div>}
      </header>
      <AutomationStrip
        automation={props.automation}
        from={props.from}
        zone={props.zone}
        now={props.now}
      />
    </>
  );
}
