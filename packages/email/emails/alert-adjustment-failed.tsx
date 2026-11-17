/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { type CommissionerAlertInput, commissionerAlertRecord } from "../src/commissioner-alert";
import { EmailLayout } from "../src/layout";
import { ALERT_SAMPLE } from "./alert-sample";

export default function AlertAdjustmentFailedPreview(input: CommissionerAlertInput) {
  return <EmailLayout record={commissionerAlertRecord(input)} />;
}

AlertAdjustmentFailedPreview.PreviewProps = {
  ...ALERT_SAMPLE,
  ...{
    amount: { tenths: -310, kind: "computed" },
    situation: { kind: "review", reason: "adjustment_failed" },
  },
} satisfies CommissionerAlertInput;
