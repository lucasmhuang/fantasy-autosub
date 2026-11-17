/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { type CommissionerAlertInput, commissionerAlertRecord } from "../src/commissioner-alert";
import { EmailLayout } from "../src/layout";
import { ALERT_SAMPLE } from "./alert-sample";

export default function AlertLineupFailedPreview(input: CommissionerAlertInput) {
  return <EmailLayout record={commissionerAlertRecord(input)} />;
}

AlertLineupFailedPreview.PreviewProps = {
  ...ALERT_SAMPLE,
  ...{ situation: { kind: "review", reason: "lineup_failed" } },
} satisfies CommissionerAlertInput;
