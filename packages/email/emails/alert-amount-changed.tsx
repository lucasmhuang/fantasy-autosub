/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { type CommissionerAlertInput, commissionerAlertRecord } from "../src/commissioner-alert";
import { EmailLayout } from "../src/layout";
import { ALERT_SAMPLE } from "./alert-sample";

export default function AlertAmountChangedPreview(input: CommissionerAlertInput) {
  return <EmailLayout record={commissionerAlertRecord(input)} />;
}

AlertAmountChangedPreview.PreviewProps = {
  ...ALERT_SAMPLE,
  ...{
    amount: { tenths: -334, kind: "computed" },
    situation: { kind: "review", reason: "adjustment_changed", nowTenths: -334, thenTenths: -310 },
  },
} satisfies CommissionerAlertInput;
