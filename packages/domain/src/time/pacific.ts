const pacificFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// Times the commissioner's emails show, labelled PT (Dec-D32d): "Sun, 11/15, 1:00 PM PT".
export function formatPacificMoment(moment: Date): string {
  return `${pacificFormat.format(moment)} PT`;
}
