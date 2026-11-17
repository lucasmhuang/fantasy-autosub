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
// `alert` puts the amber dot before its first sentence. No closing line or footer: an email says
// its facts and stops (the friends voice, owner 2026-11-17).
export type EmailRecord = {
  kind: "code" | "alert";
  subject: string;
  // The first sentence, which inboxes show as the preview line.
  lead: string;
  code?: string;
  facts?: readonly EmailFact[];
  body?: readonly string[];
};

function factLine(fact: EmailFact): string {
  return `${fact.label}: ${fact.meta === undefined ? fact.value : `${fact.value} ${fact.meta}`}`;
}

// The plain-text part, laid out as step 6's `text_part`: the code appears only in its sentence.
export function textPartOf(record: EmailRecord): string {
  const blocks = [record.lead];
  const facts = record.facts ?? [];
  if (facts.length > 0) blocks.push(facts.map(factLine).join("\n"));
  blocks.push(...(record.body ?? []));
  return blocks.join("\n\n");
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
