import { Notice, SectionHeader } from "@injurysub/ui";
import Link from "next/link";
import { renderCommissionerStatus } from "../../app/(commish)/commish/status-messages";
import type { PageAutomation } from "../../lib/server/commish-alerts";
import type { SettingsPage } from "../../lib/server/settings-page";
import { AddressStatusNotice } from "../board/status-notice";
import { restoreHint } from "./automation-copy";
import { CommishTitle } from "./commish-title";
import { provingText, settingsNotice } from "./settings-copy";
import { SettingsForm } from "./settings-form";

type Props = {
  page: Extract<SettingsPage, { status: "found" }>;
  automation: PageAutomation;
  status: string | undefined;
  zone: string;
  now: Date;
};

// Settings (FS-SETTINGS-1 to -6): the mode, the teams automation may act for, and proving on the
// commissioner's own team, where it's opened and marked done (Revision 4, E).
export function SettingsView({ page, automation, status, zone, now }: Props) {
  const { settings } = page;
  const notice = settingsNotice(status, settings.updatedAt, { zone, now });
  const hint = restoreHint(automation);
  return (
    <div className="page form flow">
      <CommishTitle
        title="Settings"
        sub="Applies to requests confirmed from now on."
        automation={automation}
        from="/commish/settings"
        zone={zone}
        now={now}
      />
      {hint && <p className="text-[12px] text-text-meta">{hint}</p>}
      {notice === null ? (
        <AddressStatusNotice status={status} render={renderCommissionerStatus} />
      ) : (
        <Notice tone={notice.tone} announce>
          {notice.text}
        </Notice>
      )}
      <SettingsForm
        mode={settings.executionMode}
        ticked={settings.writeAllowlist}
        shownUpdatedAt={settings.updatedAt?.toISOString() ?? ""}
        teams={page.teams}
      />
      <section className="panel stack-12 px-(--space-16) py-(--space-12)" aria-labelledby="h-prov">
        <SectionHeader id="h-prov">Proving on your team</SectionHeader>
        <p className="text-[14px] text-text-2">{provingText(settings.provingDoneAt, zone)}</p>
        <div className="flex flex-wrap gap-(--space-8)">
          <Link className="btn-sec" href="/commish/proving">
            Open proving
          </Link>
          <form method="post" action="/commish/proving/done">
            <button className="btn-sec" type="submit" disabled={settings.provingDoneAt !== null}>
              Mark proving done
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
