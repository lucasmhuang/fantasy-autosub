import { formatRecentMoment } from "@injurysub/domain";
import { RequestRow } from "@injurysub/ui";
import { faceImageProps } from "../../lib/server/images";
import type { HistoryEntry } from "../../lib/server/request-view";
import { requestPill, signedPoints } from "./board-copy";
import { surname } from "./option-copy";

// The team's requests as rows, newest first as given; each row opens its request. Shared by the
// team page and the Requests list.
export function RequestRows({
  requests,
  zone,
  now,
  commissioner,
}: {
  requests: HistoryEntry[];
  zone: string;
  now: Date;
  commissioner: string;
}) {
  return (
    <div className="list-panel">
      {requests.map((entry) => (
        <RequestRow
          key={entry.requestId}
          title={`${surname(entry.replacementName)} in for ${surname(entry.injuredName)}`}
          incoming={{ face: faceImageProps(String(entry.replacementPlayerId), 54) }}
          outgoing={{ face: faceImageProps(String(entry.injuredPlayerId), 54), out: true }}
          amount={signedPoints(entry.amountTenths)}
          status={requestPill(entry.status, commissioner)}
          when={`${formatRecentMoment(entry.filedAt, zone, now)} · week ${entry.matchupPeriodId}`}
          href={`/app/requests/${entry.requestId}`}
        />
      ))}
    </div>
  );
}
