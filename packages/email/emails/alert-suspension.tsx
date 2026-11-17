/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { type CommissionerAlertInput, commissionerAlertRecord } from "../src/commissioner-alert";
import { EmailLayout } from "../src/layout";
import { ALERT_SAMPLE } from "./alert-sample";

export default function AlertSuspensionPreview(input: CommissionerAlertInput) {
  return <EmailLayout record={commissionerAlertRecord(input)} />;
}

AlertSuspensionPreview.PreviewProps = {
  ...ALERT_SAMPLE,
  ...{
    teamName: "Backdoor Cutters",
    injuredName: "Pascal Siakam",
    replacementName: "Bennedict Mathurin",
    slot: "F",
    askedBy: "Jordan",
    amount: { tenths: -226, kind: "projected" },
    situation: { kind: "review", reason: "suspension" },
  },
} satisfies CommissionerAlertInput;
