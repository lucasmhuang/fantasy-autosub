/** @jsxRuntime automatic */
/** @jsxImportSource react */
// A preview of the shared layout with invented content, until each email has its own entry.
import { EmailLayout } from "../src/layout";
import type { EmailRecord } from "../src/record";

export default function LayoutPreview({ record }: { record: EmailRecord }) {
  return <EmailLayout record={record} />;
}

LayoutPreview.PreviewProps = {
  record: {
    kind: "alert",
    subject: "Stretch Fours needs you",
    lead: "A request from Stretch Fours is waiting for your approval.",
    facts: [
      { label: "Swap", value: "Jonas Valančiūnas in for Domantas Sabonis · C slot" },
      { label: "Asked", value: "Wed Nov 11, 4:02 PM PT, by Marcus" },
      { label: "Adjustment", value: "−31.0", meta: "projected", tone: "out" },
    ],
    body: [
      "Approving re-checks ESPN, then makes the swap and posts −31.0. If it isn’t approved by Thu 4:02 AM PT, it expires and stays in your queue.",
    ],
    action: "Approve it, settle it by hand or reject it in InjurySub’s queue.",
    foot: [
      "Sent to you as the league’s commissioner on InjurySub.",
      "Not affiliated with ESPN or the NBA.",
    ],
  },
} satisfies { record: EmailRecord };
