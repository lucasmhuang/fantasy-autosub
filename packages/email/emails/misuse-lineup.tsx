/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { EmailLayout } from "../src/layout";
import { type MisuseAlertEmailInput, misuseAlertRecord } from "../src/notices";
import { MISUSE_SAMPLE } from "./misuse-sample";

export default function MisuseLineupPreview(input: MisuseAlertEmailInput) {
  return <EmailLayout record={misuseAlertRecord(input)} />;
}

MisuseLineupPreview.PreviewProps = { ...MISUSE_SAMPLE, ...{} } satisfies MisuseAlertEmailInput;
