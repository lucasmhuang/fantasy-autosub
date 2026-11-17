/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { type CommissionerAlertInput, commissionerAlertRecord } from "../src/commissioner-alert";
import { EmailLayout } from "../src/layout";
import { ALERT_SAMPLE } from "./alert-sample";

export default function AlertWeekEndedPreview(input: CommissionerAlertInput) {
  return <EmailLayout record={commissionerAlertRecord(input)} />;
}

AlertWeekEndedPreview.PreviewProps = {
  ...ALERT_SAMPLE,
  ...{
    teamName: "Pick & Roll Call",
    injuredName: "De’Aaron Fox",
    replacementName: "Keon Ellis",
    slot: "G",
    askedBy: "Theo",
    amount: { tenths: -143, kind: "projected" },
    situation: { kind: "review", reason: "week_ended", week: 4 },
  },
} satisfies CommissionerAlertInput;
