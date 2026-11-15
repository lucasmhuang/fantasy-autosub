"use client";

import { useEffect } from "react";
import { zoneToReport } from "./zone-report";

// Tells the server this device's zone once a signed-in page has loaded, when the session doesn't
// hold it yet, so the pages after this one show times in it; this one keeps PT. A report that
// fails is sent again by the next page.
export function ZoneReporter({ stored }: { stored: string | null }) {
  useEffect(() => {
    const zone = zoneToReport(Intl.DateTimeFormat().resolvedOptions().timeZone, stored);
    if (zone === null) return;
    void fetch("/session/zone", { method: "POST", body: new URLSearchParams({ zone }) });
  }, [stored]);
  return null;
}
