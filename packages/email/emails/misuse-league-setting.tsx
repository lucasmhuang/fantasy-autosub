/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { EmailLayout } from "../src/layout";
import { type MisuseAlertEmailInput, misuseAlertRecord } from "../src/notices";
import { MISUSE_SAMPLE } from "./misuse-sample";

export default function MisuseLeagueSettingPreview(input: MisuseAlertEmailInput) {
  return <EmailLayout record={misuseAlertRecord(input)} />;
}

MisuseLeagueSettingPreview.PreviewProps = {
  ...MISUSE_SAMPLE,
  ...{
    kind: "lm_league_change",
    teamId: null,
    teamName: null,
    what: "A league-manager change InjurySub didn't make, in the league's settings (ESPN's message type 150).",
    undo: [
      "Check the league's settings and schedule in ESPN's LM tools, and change back anything you didn't make.",
    ],
    moves: [],
  },
} satisfies MisuseAlertEmailInput;
