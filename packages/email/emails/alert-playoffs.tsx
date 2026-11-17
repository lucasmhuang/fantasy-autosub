/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { type CommissionerAlertInput, commissionerAlertRecord } from "../src/commissioner-alert";
import { EmailLayout } from "../src/layout";
import { ALERT_SAMPLE } from "./alert-sample";

export default function AlertPlayoffsPreview(input: CommissionerAlertInput) {
  return <EmailLayout record={commissionerAlertRecord(input)} />;
}

AlertPlayoffsPreview.PreviewProps = {
  ...ALERT_SAMPLE,
  ...{ situation: { kind: "review", reason: "playoffs" } },
} satisfies CommissionerAlertInput;
