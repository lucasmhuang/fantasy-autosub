// Makes recorded ESPN responses safe for a public repo, and checks recordings before they're written
// or committed. Identifying values are members' names, display names and ids (SWIDs), member-chosen
// team names, abbreviations and logos, the league's id and name, and the espn_s2 cookie. The owner's
// private lists (watch list, pending claims, draft strategy), members' notification settings and the
// league's creation and update records never reach a recording.

export type RecordingIdentities = {
  leagueId: number;
  leagueName?: string;
  espnS2?: string;
  members: readonly RecordingMember[];
  teams: readonly RecordingTeam[];
};

export type RecordingMember = {
  id: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
};

export type RecordingTeam = {
  id: number;
  name?: string;
  abbrev?: string;
  owners?: readonly string[];
  primaryOwner?: string;
};

export type IdentifyingValueKind =
  | "member id"
  | "member name"
  | "member full name"
  | "display name"
  | "team name"
  | "team abbreviation"
  | "league name"
  | "league id"
  | "espn_s2";

export type IdentifyingValue = { file: string; path: string; kind: IdentifyingValueKind };

export type RecordingShapeProblem = { file: string; path: string; problem: string };

const RECORDED_LEAGUE_ID = 0;
const RECORDED_LEAGUE_NAME = "Recorded League";
// The core of a SWID, without its braces, so a replacement keeps whatever braces surround it.
const MEMBER_ID_PATTERN = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/gi;
const PLACEHOLDER_ID_CORE = /^00000000-0000-0000-0000-\d{12}$/;
// espn_s2 is a URL-encoded token of about 320 characters; nothing else ESPN sends is this long.
const COOKIE_TOKEN_PATTERN = /[A-Za-z0-9%+/=]{100,}/;
const DROPPED_KEYS = new Set([
  "draftStrategy",
  "notificationSettings",
  "creationInfo",
  "lastUpdateInfo",
  "logo",
  "logoType",
]);
const EMPTIED_LISTS = new Set(["watchList", "pendingTransactions", "pendingTransactionIds"]);
const FORBIDDEN_KEYS = new Set([
  ...DROPPED_KEYS,
  "draftList",
  "futureKeeperPlayerIds",
  "clientAddress",
]);
const MEMBER_PLACEHOLDERS = {
  firstName: /^Member$/,
  lastName: /^\d+$/,
  displayName: /^member-\d+$/,
};
const TEAM_PLACEHOLDERS = {
  name: /^Team \d+$/,
  abbrev: /^T\d+$/,
  location: /^Team$/,
  nickname: /^\d+$/,
};

type Report = (path: string, problem: string) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ESPN league responses carry seasonId and segmentId at the top; the season and game roots don't.
function isLeagueBody(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && "seasonId" in value && "segmentId" in value;
}

function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function matchesOf(text: string, globalPattern: RegExp): readonly string[] {
  return text.match(globalPattern) ?? [];
}

function normalizeMemberId(id: string): string {
  return id.replace(/[{}]/g, "").toUpperCase();
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function placeholderMemberId(memberNumber: number): string {
  return `{00000000-0000-0000-0000-${String(memberNumber).padStart(12, "0")}}`;
}

// Member N is the primary owner of team N, so the recorded league stays coherent. Members who
// own no team are numbered after the highest team id.
function numberMembers(identities: RecordingIdentities): Map<string, number> {
  const numbers = new Map<string, number>();
  const teams = [...identities.teams].sort((a, b) => a.id - b.id);
  for (const team of teams) {
    const owner = team.primaryOwner ?? team.owners?.[0];
    if (owner !== undefined && !numbers.has(normalizeMemberId(owner))) {
      numbers.set(normalizeMemberId(owner), team.id);
    }
  }
  let next = Math.max(0, ...teams.map((team) => team.id)) + 1;
  for (const member of identities.members) {
    if (!numbers.has(normalizeMemberId(member.id))) {
      numbers.set(normalizeMemberId(member.id), next);
      next += 1;
    }
  }
  return numbers;
}

function memberIdReplacer(numbers: Map<string, number>): (text: string) => string {
  return (text) =>
    text.replace(MEMBER_ID_PATTERN, (core) => {
      const memberNumber = numbers.get(core.toUpperCase());
      return memberNumber === undefined ? core : placeholderMemberId(memberNumber).slice(1, -1);
    });
}

function scrubMemberNames(member: unknown, numbers: Map<string, number>): unknown {
  if (!isRecord(member) || typeof member.id !== "string") return member;
  const memberNumber = numbers.get(normalizeMemberId(member.id));
  if (memberNumber === undefined) return member;
  const scrubbed: Record<string, unknown> = { ...member };
  if ("firstName" in member) scrubbed.firstName = "Member";
  if ("lastName" in member) scrubbed.lastName = String(memberNumber);
  if ("displayName" in member) scrubbed.displayName = `member-${memberNumber}`;
  return scrubbed;
}

function scrubTeamNames(team: unknown): unknown {
  if (!isRecord(team) || typeof team.id !== "number") return team;
  const scrubbed: Record<string, unknown> = { ...team };
  if ("name" in team) scrubbed.name = `Team ${team.id}`;
  if ("abbrev" in team) scrubbed.abbrev = `T${team.id}`;
  if ("location" in team) scrubbed.location = "Team";
  if ("nickname" in team) scrubbed.nickname = String(team.id);
  return scrubbed;
}

function scrubLeagueFields(body: unknown, numbers: Map<string, number>): unknown {
  if (!isLeagueBody(body)) return body;
  const scrubbed: Record<string, unknown> = { ...body, id: RECORDED_LEAGUE_ID };
  if (isRecord(body.settings) && "name" in body.settings) {
    scrubbed.settings = { ...body.settings, name: RECORDED_LEAGUE_NAME };
  }
  if (Array.isArray(body.members)) {
    scrubbed.members = body.members.map((member) => scrubMemberNames(member, numbers));
  }
  if (Array.isArray(body.teams)) scrubbed.teams = body.teams.map(scrubTeamNames);
  return scrubbed;
}

function scrubNode(node: unknown, replaceMemberIds: (text: string) => string): unknown {
  if (Array.isArray(node)) return node.map((item) => scrubNode(item, replaceMemberIds));
  if (typeof node === "string") return replaceMemberIds(node);
  if (!isRecord(node)) return node;
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED_KEYS.has(key)) continue;
    scrubbed[replaceMemberIds(key)] = EMPTIED_LISTS.has(key)
      ? []
      : scrubNode(value, replaceMemberIds);
  }
  return scrubbed;
}

// Returns the bodies under the same keys, scrubbed with placeholders that are the same for the
// same member in every call: Member N, member-n and {00000000-0000-0000-0000-0000000000NN} for the
// owner of team N; Team N and TN for team N; league id 0 and "Recorded League".
export function scrubRecording(
  bodies: Record<string, unknown>,
  identities: RecordingIdentities
): Record<string, unknown> {
  const numbers = numberMembers(identities);
  const replaceMemberIds = memberIdReplacer(numbers);
  return Object.fromEntries(
    Object.entries(bodies).map(([key, body]) => [
      key,
      scrubNode(scrubLeagueFields(body, numbers), replaceMemberIds),
    ])
  );
}

type IdentityMatcher = { kind: IdentifyingValueKind; matches: (text: string) => boolean };

function cookieForms(espnS2: string | undefined): string[] {
  if (!espnS2) return [];
  try {
    return [...new Set([espnS2, decodeURIComponent(espnS2)])];
  } catch (error) {
    if (error instanceof URIError) return [espnS2];
    throw error;
  }
}

// Names match only as a whole value, because members' first and last names occur inside NBA
// players' names. Ids, full names, the cookie and the league id match anywhere in a string.
function buildMatchers(identities: RecordingIdentities): IdentityMatcher[] {
  const matchers: IdentityMatcher[] = [];
  const whole = (kind: IdentifyingValueKind, value: string | undefined, placeholder: RegExp) => {
    const wanted = normalizeText(value);
    if (wanted && !placeholder.test(wanted)) {
      matchers.push({ kind, matches: (text) => normalizeText(text) === wanted });
    }
  };
  const within = (kind: IdentifyingValueKind, value: string) => {
    const wanted = normalizeText(value);
    if (wanted) matchers.push({ kind, matches: (text) => normalizeText(text).includes(wanted) });
  };
  for (const member of identities.members) {
    within("member id", normalizeMemberId(member.id));
    whole("member name", member.firstName, /^member$/);
    whole("member name", member.lastName, /^\d+$/);
    whole("display name", member.displayName, /^member-\d+$/);
    if (member.firstName && member.lastName) {
      within("member full name", `${member.firstName} ${member.lastName}`);
    }
  }
  for (const team of identities.teams) {
    whole("team name", team.name, /^team \d+$/);
    whole("team abbreviation", team.abbrev, /^t\d+$/);
  }
  whole("league name", identities.leagueName, /^recorded league$/);
  for (const cookie of cookieForms(identities.espnS2)) {
    matchers.push({ kind: "espn_s2", matches: (text) => text.includes(cookie) });
  }
  const leagueId = String(identities.leagueId);
  matchers.push({
    kind: "league id",
    matches: (text) => matchesOf(text, /\d+/g).includes(leagueId),
  });
  return matchers;
}

function kindsIn(text: string, matchers: readonly IdentityMatcher[]): IdentifyingValueKind[] {
  return [...new Set(matchers.filter((matcher) => matcher.matches(text)).map((m) => m.kind))];
}

function findInNode(
  node: unknown,
  path: string,
  identities: RecordingIdentities,
  matchers: readonly IdentityMatcher[],
  record: (path: string, kind: IdentifyingValueKind) => void
): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) =>
      findInNode(item, `${path}[${index}]`, identities, matchers, record)
    );
    return;
  }
  if (isRecord(node)) {
    for (const [key, value] of Object.entries(node)) {
      const keyKinds = kindsIn(key, matchers);
      // A key that is itself identifying never appears in a report path.
      const at = keyKinds.length > 0 ? `${path}[<identifying key>]` : childPath(path, key);
      for (const kind of keyKinds) record(at, kind);
      findInNode(value, at, identities, matchers, record);
    }
    return;
  }
  if (typeof node === "number" && node === identities.leagueId) record(path, "league id");
  if (typeof node === "string") for (const kind of kindsIn(node, matchers)) record(path, kind);
}

// Reports where each identifying value sits (file, JSON path and kind), never the value itself.
export function findIdentifyingValues(
  files: Record<string, unknown>,
  identities: RecordingIdentities
): IdentifyingValue[] {
  const matchers = buildMatchers(identities);
  const found: IdentifyingValue[] = [];
  for (const [file, content] of Object.entries(files)) {
    findInNode(content, "$", identities, matchers, (path, kind) =>
      found.push({ file, path, kind })
    );
  }
  return found;
}

function textProblem(text: string): string | null {
  if (matchesOf(text, MEMBER_ID_PATTERN).some((core) => !PLACEHOLDER_ID_CORE.test(core)))
    return "a member id that isn't a placeholder";
  if (COOKIE_TOKEN_PATTERN.test(text)) return "a token shaped like the espn_s2 cookie";
  return null;
}

function checkPlaceholders(
  value: unknown,
  path: string,
  placeholders: Record<string, RegExp>,
  report: Report
): void {
  if (!isRecord(value)) return;
  for (const [field, placeholder] of Object.entries(placeholders)) {
    const actual = value[field];
    if (field in value && !(typeof actual === "string" && placeholder.test(actual))) {
      report(`${path}.${field}`, `a ${field} that isn't a placeholder`);
    }
  }
}

function checkLeagueBody(body: Record<string, unknown>, path: string, report: Report): void {
  if (body.id !== RECORDED_LEAGUE_ID)
    report(`${path}.id`, "a league id other than the placeholder");
  if (
    isRecord(body.settings) &&
    "name" in body.settings &&
    body.settings.name !== RECORDED_LEAGUE_NAME
  ) {
    report(`${path}.settings.name`, "a league name other than the placeholder");
  }
  if (Array.isArray(body.members)) {
    body.members.forEach((member, index) =>
      checkPlaceholders(member, `${path}.members[${index}]`, MEMBER_PLACEHOLDERS, report)
    );
  }
  if (Array.isArray(body.teams)) {
    body.teams.forEach((team, index) =>
      checkPlaceholders(team, `${path}.teams[${index}]`, TEAM_PLACEHOLDERS, report)
    );
  }
}

function checkNode(node: unknown, path: string, report: Report): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => checkNode(item, `${path}[${index}]`, report));
    return;
  }
  if (typeof node === "string") {
    const problem = textProblem(node);
    if (problem) report(path, problem);
    return;
  }
  if (!isRecord(node)) return;
  if (isLeagueBody(node)) checkLeagueBody(node, path, report);
  for (const [key, value] of Object.entries(node)) {
    const keyProblem = textProblem(key);
    const at = keyProblem ? `${path}[<redacted key>]` : childPath(path, key);
    if (keyProblem) report(at, `a key with ${keyProblem}`);
    if (FORBIDDEN_KEYS.has(key)) report(at, `a ${key} field, which is never recorded`);
    if (EMPTIED_LISTS.has(key) && !(Array.isArray(value) && value.length === 0)) {
      report(at, `a ${key} that isn't an empty list`);
    }
    checkNode(value, at, report);
  }
}

// The structural checks a committed recording must pass. They need no secrets, so the recordings
// test runs them in CI, and the capture runs them before writing.
export function checkRecordingShape(files: Record<string, unknown>): RecordingShapeProblem[] {
  const problems: RecordingShapeProblem[] = [];
  for (const [file, content] of Object.entries(files)) {
    checkNode(content, "$", (path, problem) => problems.push({ file, path, problem }));
  }
  return problems;
}
