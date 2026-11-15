import { formatMoment, PACIFIC } from "./display";

// Times the commissioner's emails show, labelled PT (Dec-D32d): "Sun, 11/15, 1:00 PM PT".
export function formatPacificMoment(moment: Date): string {
  return formatMoment(moment, PACIFIC, "numericDate");
}
