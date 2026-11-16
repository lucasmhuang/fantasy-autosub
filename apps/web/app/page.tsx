import { getDefaultSignedInPath } from "@injurysub/domain";
import { redirect } from "next/navigation";
import { getCurrentAuthenticatedSession } from "../lib/server/auth";

// The root address has no page of its own (FS-SHELL-4): a signed-in person goes to where they
// start, anyone else to sign-in.
export default async function RootPage(): Promise<never> {
  const session = await getCurrentAuthenticatedSession();
  if (session === null) redirect("/login");
  redirect(getDefaultSignedInPath(session.user.role, session.user.teamId));
}
