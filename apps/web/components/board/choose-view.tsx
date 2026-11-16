import { formatRecentMoment } from "@injurysub/domain";
import { Button, FreshnessNote, Icon, Note, Notice, PlayerFace } from "@injurysub/ui";
import type { BoardStarter, ReadyRoute } from "../../lib/server/board";
import { faceImageProps } from "../../lib/server/images";
import { commissionerWord, points } from "./board-copy";
import { surname } from "./option-copy";
import { OptionCardFor, OptionGroups } from "./option-groups";

export type ChooseViewProps =
  | {
      // The starter's options were read: fresh, so they can be offered.
      state: "found";
      starter: BoardStarter;
      route: ReadyRoute;
      readAt: string;
      zone: string;
      now: Date;
      commissionerName: string | null;
    }
  | {
      // They couldn't be: ESPN or InjurySub's own service unreachable, or its access refused.
      state: "unread";
      injuredId: number;
      commissionerName: string | null;
    };

const backToTeam = (
  <nav className="backbar">
    <Button asChild variant="ghost" back>
      <a href="/app">Team</a>
    </Button>
  </nav>
);

// Choose: one OUT or suspended starter's bench, by how each option would go.
export function ChooseView(props: ChooseViewProps) {
  if (props.state === "unread") return <ChooseUnread {...props} />;
  const { starter, zone } = props;
  const commissioner = commissionerWord(props.commissionerName);
  const suspended = starter.designation === "SUSPENSION";
  const notValid = starter.options.filter((each) => each.status === "not_valid");
  const offered = starter.options.length - notValid.length;
  return (
    <div className="page single flow">
      {backToTeam}
      <ChooseHead starter={starter} />
      {suspended && (
        <p className="text-[14px] text-text-2">{`Pick one; ${commissioner} settles it.`}</p>
      )}
      {offered === 0 && (
        <section className="stack-12">
          <Note kind="stop">{`No one on your bench fits a legal lineup with ${surname(starter.name)} out.`}</Note>
          <p className="text-[14px] text-text-2">
            {`${commissioner} can look at moves InjurySub doesn't make, like two starters changing slots at once.`}
          </p>
        </section>
      )}
      <OptionGroups
        injuredId={starter.playerId}
        options={starter.options}
        route={props.route}
        commissioner={commissioner}
        zone={zone}
        grid="grid2 is-wide"
      />
      {notValid.length > 0 && (
        <details aria-label="Not valid">
          <summary className="disclosure">
            <span>
              <span className="t-label">Not valid</span>
              {notValid.length}
            </span>
            <Icon name="chevron-down" size={18} className="ico" />
          </summary>
          <div className="grid2 is-wide mt-(--space-10)">
            {notValid.map((option) => (
              <OptionCardFor
                key={option.playerId}
                option={option}
                injuredId={starter.playerId}
                route={props.route}
                commissioner={commissioner}
                zone={zone}
              />
            ))}
          </div>
        </details>
      )}
      <FreshnessNote
        readAt={formatRecentMoment(new Date(props.readAt), zone, props.now)}
        refreshHref={`/app/requests/new?injured=${starter.playerId}`}
      />
    </div>
  );
}

function ChooseHead({ starter }: { starter: BoardStarter }) {
  const suspended = starter.designation === "SUSPENSION";
  return (
    <header className="choosehead">
      <div className={suspended ? "thumb is-susp" : "thumb"}>
        <PlayerFace image={faceImageProps(String(starter.playerId), 84, { eager: true })} />
        <div className="band">{suspended ? "SUSP" : "OUT"}</div>
      </div>
      <div>
        <h1 className="t-title">{`Replace ${starter.name}`}</h1>
        <div className="mt-(--space-4) text-[13px] text-text-meta">
          {`${starter.slot} slot · ${suspended ? "suspended · " : ""}a swap forfeits `}
          <b className={suspended ? "num text-wait" : "num text-out-strong"}>
            {points(starter.forfeitTenths / 10)}
          </b>
        </div>
      </div>
    </header>
  );
}

function ChooseUnread(props: Extract<ChooseViewProps, { state: "unread" }>) {
  const commissioner = commissionerWord(props.commissionerName);
  return (
    <div className="page single flow">
      {backToTeam}
      <Notice
        tone="info"
        action={{ label: "Try again", href: `/app/requests/new?injured=${props.injuredId}` }}
      >
        {`Can't reach ESPN right now, so your options can't be checked. Starter ruled OUT? Text ${commissioner}; they can file it with the time you asked.`}
      </Notice>
    </div>
  );
}
