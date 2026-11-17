/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { type CommissionerAlertInput, commissionerAlertRecord } from "../src/commissioner-alert";
import { EmailLayout } from "../src/layout";
import { ALERT_SAMPLE } from "./alert-sample";

export default function AlertExpiredPreview(input: CommissionerAlertInput) {
  return <EmailLayout record={commissionerAlertRecord(input)} />;
}

AlertExpiredPreview.PreviewProps = {
  ...ALERT_SAMPLE,
  ...{ situation: { kind: "review", reason: "expired", hours: 12 } },
} satisfies CommissionerAlertInput;
