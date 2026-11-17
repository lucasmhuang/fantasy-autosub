/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { type CommissionerAlertInput, commissionerAlertRecord } from "../src/commissioner-alert";
import { EmailLayout } from "../src/layout";
import { ALERT_SAMPLE } from "./alert-sample";

export default function AlertRearrangementPreview(input: CommissionerAlertInput) {
  return <EmailLayout record={commissionerAlertRecord(input)} />;
}

AlertRearrangementPreview.PreviewProps = {
  ...ALERT_SAMPLE,
  ...{
    situation: {
      kind: "review",
      reason: "rearrangement",
      moves: [
        { name: "Lauri Markkanen", toSlot: "F/C" },
        { name: "Bam Adebayo", toSlot: "C" },
      ],
    },
  },
} satisfies CommissionerAlertInput;
