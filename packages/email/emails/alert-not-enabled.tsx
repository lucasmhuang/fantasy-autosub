/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { type CommissionerAlertInput, commissionerAlertRecord } from "../src/commissioner-alert";
import { EmailLayout } from "../src/layout";
import { ALERT_SAMPLE } from "./alert-sample";

export default function AlertNotEnabledPreview(input: CommissionerAlertInput) {
  return <EmailLayout record={commissionerAlertRecord(input)} />;
}

AlertNotEnabledPreview.PreviewProps = {
  ...ALERT_SAMPLE,
  ...{ situation: { kind: "review", reason: "not_allowlisted" } },
} satisfies CommissionerAlertInput;
