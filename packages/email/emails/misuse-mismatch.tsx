/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { EmailLayout } from "../src/layout";
import { type MisuseAlertEmailInput, misuseAlertRecord } from "../src/notices";
import { MISUSE_SAMPLE } from "./misuse-sample";

export default function MisuseMismatchPreview(input: MisuseAlertEmailInput) {
  return <EmailLayout record={misuseAlertRecord(input)} />;
}

MisuseMismatchPreview.PreviewProps = {
  ...MISUSE_SAMPLE,
  ...{
    kind: "adjustment_mismatch",
    espnAt: null,
    what: "Backdoor Cutters' adjustment in Matchup 3 is −15.0 on ESPN, but InjurySub's records make it −22.6.",
    undo: [
      "If InjurySub's records are right: on ESPN's Scoreboard, open matchup 3 and set its adjustment to −22.6.",
    ],
    moves: [],
  },
} satisfies MisuseAlertEmailInput;
