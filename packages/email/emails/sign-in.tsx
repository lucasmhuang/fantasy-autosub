/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { EmailLayout } from "../src/layout";
import { type SignInCodeRecordInput, signInCodeRecord } from "../src/sign-in";

export default function SignInPreview(props: SignInCodeRecordInput) {
  return <EmailLayout record={signInCodeRecord(props)} />;
}

SignInPreview.PreviewProps = { code: "482913", ttlMinutes: 10 } satisfies SignInCodeRecordInput;
