import { createElement } from "react";
import { render } from "react-email";
import { EmailLayout } from "./layout";
import { type EmailRecord, textPartOf } from "./record";

export type RenderedEmail = { html: string; text: string };

// Both parts of an email from its one record (Revision 6 F).
export async function renderEmail(record: EmailRecord): Promise<RenderedEmail> {
  const html = await render(createElement(EmailLayout, { record }));
  return { html, text: textPartOf(record) };
}
