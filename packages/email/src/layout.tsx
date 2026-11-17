/** @jsxRuntime automatic */
/** @jsxImportSource react */
// The worker runs this file under `node --import tsx` from the repo root, where no tsconfig is
// read and JSX compiles the classic way, so each .tsx in this package names its JSX runtime.
import type { CSSProperties } from "react";
import { Body, Container, Head, Html } from "react-email";
import type { EmailFact, EmailRecord } from "./record";

// Step 6's palette as literal hex (email clients don't read CSS variables). text-faint isn't
// used: after Gmail's inversion it falls below 4.5:1 (step 6's `tools/invert_contrast.py`).
const GROUND = "#0c0c0d";
const SURFACE = "#161618";
const LINE = "#26262a";
const LINE_STRONG = "#3a3a3f";
const TEXT = "#ededee";
const TEXT_BRIGHT = "#f1f1f2";
const TEXT_2 = "#c9c9ce";
const TEXT_META = "#a8a8ad";
const WAIT = "#ffca16";
const OUT = "#ff9592";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const LEAD: CSSProperties = {
  margin: "0 0 20px",
  fontSize: "18px",
  lineHeight: 1.4,
  fontWeight: 600,
  color: TEXT,
};
const PARAGRAPH: CSSProperties = {
  margin: "0 0 14px",
  fontSize: "16px",
  lineHeight: 1.5,
  color: TEXT_2,
};
const DOT: CSSProperties = {
  display: "inline-block",
  width: "10px",
  height: "10px",
  borderRadius: "5px",
  backgroundColor: WAIT,
  margin: "0 10px 0 0",
  verticalAlign: "1px",
};
const PANEL: CSSProperties = {
  margin: "0 0 20px",
  backgroundColor: SURFACE,
  border: `1px solid ${LINE_STRONG}`,
  borderRadius: "16px",
  borderCollapse: "separate",
};
const FACT_LABEL: CSSProperties = {
  margin: "0 0 3px",
  fontSize: "13px",
  lineHeight: 1.35,
  color: TEXT_META,
};
const FACT_VALUE: CSSProperties = { margin: 0, fontSize: "16px", lineHeight: 1.45, color: TEXT };
const CODE_BOX: CSSProperties = {
  margin: "0 0 24px",
  backgroundColor: SURFACE,
  border: `1px solid ${LINE_STRONG}`,
  borderRadius: "14px",
  borderCollapse: "separate",
};
const CODE_DIGITS: CSSProperties = {
  fontSize: "40px",
  lineHeight: 1,
  fontWeight: 700,
  letterSpacing: "0.06em",
  fontVariantNumeric: "tabular-nums",
  color: TEXT_BRIGHT,
};

// Apple Mail underlines times, dates and numbers as tappable unless told not to (step 6).
const DATA_DETECTORS =
  "a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important;font-size:inherit !important;font-family:inherit !important;font-weight:inherit !important;line-height:inherit !important}";

function Lead({ record }: { record: EmailRecord }) {
  if (record.code === undefined) {
    return (
      <p style={LEAD}>
        {record.kind === "alert" ? <span aria-hidden="true" style={DOT} /> : null}
        {record.lead}
      </p>
    );
  }
  // The code stays inside its sentence, which a phone reads to offer it for autofill.
  const [before = "", after = ""] = record.lead.split(record.code);
  return (
    <p style={LEAD}>
      {before}
      <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {record.code}
      </span>
      {after}
    </p>
  );
}

// The code again, large and grouped 3 + 3 by a margin rather than a space, so a copy picks up six
// digits. Hidden from screen readers and from the text part: the sentence already says it.
function CodeBlock({ code }: { code: string }) {
  return (
    <table
      role="presentation"
      aria-hidden="true"
      data-skip-in-text="true"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      style={CODE_BOX}
    >
      <tbody>
        <tr>
          <td style={{ padding: "16px 22px 15px" }}>
            <span style={CODE_DIGITS}>
              {code.slice(0, 3)}
              <span style={{ marginLeft: "0.32em" }}>{code.slice(3)}</span>
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function FactValue({ fact }: { fact: EmailFact }) {
  if (fact.meta === undefined && fact.tone === undefined) return <>{fact.value}</>;
  return (
    <>
      <span
        style={{
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          color: fact.tone === "out" ? OUT : TEXT,
        }}
      >
        {fact.value}
      </span>
      {fact.meta === undefined ? null : (
        <>
          {" "}
          <span style={{ color: TEXT_META }}>{fact.meta}</span>
        </>
      )}
    </>
  );
}

// The facts panel: a table, so Outlook's desktop engine draws its ground; rules between rows sit
// inside the panel's 16 px side padding, as step 6 draws them.
function Facts({ facts }: { facts: readonly EmailFact[] }) {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      width="100%"
      style={PANEL}
    >
      <tbody>
        <tr>
          <td style={{ padding: "3px 16px" }}>
            <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%">
              <tbody>
                {facts.map((fact, index) => (
                  <tr key={`${index}:${fact.label}`}>
                    <td
                      style={{
                        padding: "11px 0",
                        borderTop: index === 0 ? undefined : `1px solid ${LINE}`,
                      }}
                    >
                      <p style={FACT_LABEL}>{fact.label}</p>
                      <p style={FACT_VALUE}>
                        <FactValue fact={fact} />
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// One layout for every email: dark ground, text only, the first sentence first (FS-EMAIL-2, -3).
export function EmailLayout({ record }: { record: EmailRecord }) {
  return (
    <Html lang="en">
      <Head>
        <meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />
        {/* Gmail's apps honour only `light only` and invert this dark email otherwise. */}
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
        <style>{DATA_DETECTORS}</style>
      </Head>
      <Body style={{ backgroundColor: GROUND, margin: 0, padding: 0 }}>
        <Container
          style={{
            maxWidth: "560px",
            padding: "28px 20px 32px",
            fontFamily: FONT,
            color: TEXT,
            WebkitTextSizeAdjust: "100%",
          }}
        >
          <Lead record={record} />
          {record.code === undefined ? null : <CodeBlock code={record.code} />}
          {record.facts === undefined || record.facts.length === 0 ? null : (
            <Facts facts={record.facts} />
          )}
          {(record.body ?? []).map((paragraph) => (
            <p key={paragraph} style={PARAGRAPH}>
              {paragraph}
            </p>
          ))}
        </Container>
      </Body>
    </Html>
  );
}
