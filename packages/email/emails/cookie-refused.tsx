/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { EmailLayout } from "../src/layout";
import { type CredentialsRefusedEmailInput, credentialsRefusedRecord } from "../src/notices";

export default function CookieRefusedPreview(input: CredentialsRefusedEmailInput) {
  return <EmailLayout record={credentialsRefusedRecord(input)} />;
}

CookieRefusedPreview.PreviewProps = {
  to: "commissioner@example.test",
  since: new Date("2026-11-12T02:31:00.000Z"),
  waiting: 2,
} satisfies CredentialsRefusedEmailInput;
