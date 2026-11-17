/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { type CommissionerAlertInput, commissionerAlertRecord } from "../src/commissioner-alert";
import { EmailLayout } from "../src/layout";
import { ALERT_SAMPLE } from "./alert-sample";

export default function AlertAdjustmentHeldPreview(input: CommissionerAlertInput) {
  return <EmailLayout record={commissionerAlertRecord(input)} />;
}

AlertAdjustmentHeldPreview.PreviewProps = {
  ...ALERT_SAMPLE,
  ...{
    amount: { tenths: -310, kind: "computed" },
    situation: {
      kind: "review",
      reason: "adjustment_held_rules",
      rules: { first: "Steals score 2 on ESPN; InjurySub expects 3", more: 0 },
    },
  },
} satisfies CommissionerAlertInput;
