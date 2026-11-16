import { redirect } from "next/navigation";

// The shell's Requests destination, until R7d-7 builds the list: the Team page lists the team's
// requests below its board, and guards itself.
export default function RequestsPage(): never {
  redirect("/app");
}
