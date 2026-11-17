/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { EmailLayout } from "../src/layout";
import { type MisuseAlertEmailInput, misuseAlertRecord } from "../src/notices";
import { MISUSE_SAMPLE } from "./misuse-sample";

export default function MisuseLeaguePublicPreview(input: MisuseAlertEmailInput) {
  return <EmailLayout record={misuseAlertRecord(input)} />;
}

MisuseLeaguePublicPreview.PreviewProps = {
  ...MISUSE_SAMPLE,
  ...{
    kind: "league_public",
    teamId: null,
    teamName: null,
    espnAt: null,
    what: "The league is public on ESPN: anyone with its id can read every member's name.",
    undo: ["Set the league back to private in ESPN's league settings."],
    moves: [],
  },
} satisfies MisuseAlertEmailInput;
