/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { EmailLayout } from "../src/layout";
import { type MisuseAlertEmailInput, misuseAlertRecord } from "../src/notices";
import { MISUSE_SAMPLE } from "./misuse-sample";

export default function MisuseAdjustmentPreview(input: MisuseAlertEmailInput) {
  return <EmailLayout record={misuseAlertRecord(input)} />;
}

MisuseAdjustmentPreview.PreviewProps = {
  ...MISUSE_SAMPLE,
  ...{
    kind: "lm_adjustment",
    what: "A score adjustment InjurySub didn't make on Backdoor Cutters, matchup 3: ESPN's total went from 410.5 to 395.5 (−15.0), reason \"Correction\".",
    undo: [
      "On ESPN's Scoreboard, open matchup 3, then Adjust Scoring on Backdoor Cutters' pairing, and change its adjustment by +15.0.",
    ],
    moves: [],
  },
} satisfies MisuseAlertEmailInput;
