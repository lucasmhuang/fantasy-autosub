// The zone a page should report for this device, or null: the browser's own zone, unless the
// session already holds it. Both are compared as this runtime names them, so an alias the browser
// reports ("US/Eastern") doesn't send a report on every page.
export function zoneToReport(deviceZone: string, storedZone: string | null): string | null {
  if (deviceZone === "") return null;
  if (storedZone !== null && runtimeName(storedZone) === runtimeName(deviceZone)) return null;
  return deviceZone;
}

function runtimeName(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}
