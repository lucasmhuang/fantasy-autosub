/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { type CommissionerAlertInput, commissionerAlertRecord } from "../src/commissioner-alert";
import { EmailLayout } from "../src/layout";
import { ALERT_SAMPLE } from "./alert-sample";

export default function AlertAutomationOffPreview(input: CommissionerAlertInput) {
  return <EmailLayout record={commissionerAlertRecord(input)} />;
}

AlertAutomationOffPreview.PreviewProps = {
  ...ALERT_SAMPLE,
  ...{ situation: { kind: "review", reason: "automation_off" } },
} satisfies CommissionerAlertInput;
