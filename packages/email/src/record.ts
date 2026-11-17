import { formatTenths } from "@injurysub/domain";

// One fact in an email's panel. A value with a meta word or a tone is a number set apart from its
// word ("−31.0" and "projected"); `out` draws the number in the points-taken-off tone.
export type EmailFact = {
  label: string;
  value: string;
  meta?: string;
  tone?: "out";
};

// Every email as one record (step 6's `gen/emails.py`): both its HTML and its text part are built
// from it, so the two say the same words. A `code` email shows its sign-in code large as well; an
// `alert` puts the amber dot before its first sentence.
export type EmailRecord = {
  kind: "code" | "alert";
  subject: string;
  // The first sentence, which inboxes show as the preview line.
  lead: string;
  code?: string;
  facts?: readonly EmailFact[];
  body?: readonly string[];
  action?: string;
  note?: string;
  foot: readonly string[];
};

function factLine(fact: EmailFact): string {
  return `${fact.label}: ${fact.meta === undefined ? fact.value : `${fact.value} ${fact.meta}`}`;
}

// The plain-text part, laid out as step 6's `text_part`: the code appears only in its sentence.
export function textPartOf(record: EmailRecord): string {
  const facts = record.facts ?? [];
  const lines = [record.lead, ""];
  if (facts.length > 0) lines.push(...facts.map(factLine), "");
  for (const paragraph of record.body ?? []) lines.push(paragraph, "");
  if (record.action !== undefined) lines.push(record.action, "");
  if (record.note !== undefined) lines.push(record.note, "");
  lines.push(...record.foot);
  return lines.join("\n");
}

// An amount of points as the emails write it: signed, with a minus sign rather than a hyphen.
export function emailAmount(tenths: number): string {
  return formatTenths(tenths, { signed: true }).replace("-", "−");
}

// "Keegan Murray" → "Murray"; a one-word name stays whole (the board's rule, `option-copy.ts`).
export function surname(name: string): string {
  const [, ...rest] = name.trim().split(/\s+/);
  return rest.length === 0 ? name : rest.join(" ");
}
