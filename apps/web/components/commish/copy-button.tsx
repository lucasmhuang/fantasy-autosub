"use client";

import { Button } from "@injurysub/ui";
import { useState } from "react";
import { copyValue } from "./copy-state";

// A value's Copy button in the by-hand steps; `what` names it for a screen reader.
export function CopyButton({ text, what }: { text: string; what: string }) {
  const [label, setLabel] = useState("Copy");
  return (
    <Button
      variant="ghost"
      type="button"
      aria-label={label === "Copy" ? `Copy ${what}` : label}
      onClick={() =>
        copyValue(text, { write: (value) => navigator.clipboard.writeText(value), show: setLabel })
      }
    >
      {label}
    </Button>
  );
}
