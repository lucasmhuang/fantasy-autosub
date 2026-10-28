import { EspnError } from "../read/errors";

// Makes recorded ESPN responses safe for a public repo, and checks recordings before they're written
// or committed. Identifying values are members' names, display names and ids (SWIDs), member-chosen
// team names, abbreviations and logos, the league's id and name, and the espn_s2 cookie. The owner's
// private lists (watch list, pending claims, draft strategy), members' notification settings and the
// league's creation and update records never reach a recording.
//
// A recording file is a JSON object of request key → response body. Every rule keys on field names,
// never on which ESPN fields a request schema happened to keep.

export type RecordingIdentities = {
  leagueId: number;
  leagueName: string;
  espnS2: string;
  members: readonly RecordingMember[];
  teams: readonly RecordingTeam[];
};

export type RecordingMember = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
};

export type RecordingTeam = {
  id: number;
  name: string;
  abbrev: string;
  owners: readonly string[];
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
// A member id (SWID) is a GUID. Its core is matched without braces, so a replacement keeps whatever
// surrounds it, and also without dashes.
const MEMBER_ID_PATTERN = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/gi;
const DASHLESS_ID_PATTERN = /(?<![0-9A-F])[0-9A-F]{32}(?![0-9A-F])/gi;
const PLACEHOLDER_ID_CORE = /^00000000-0000-0000-0000-\d{12}$/;
const PLACEHOLDER_DASHLESS_CORE = /^0{20}\d{12}$/;
const PLACEHOLDER_MEMBER_ID = /^\{00000000-0000-0000-0000-\d{12}\}$/;
// espn_s2 is a URL-encoded token of about 320 characters; nothing else ESPN sends is this long.
const COOKIE_TOKEN_PATTERN = /[A-Za-z0-9%+/=]{100,}/;
// Keys a report may print. Any other key (one with a space, say) shows as [<key>].
const PRINTABLE_KEY = /^[\w$:.,=&@|-]+$/;

// The scrub drops these wherever they appear, and empties these lists. The owner's watch list and
// pending claims stay as empty presence markers, which the credential check reads.
const DROPPED_KEYS = new Set([
  "draftStrategy",
  "notificationSettings",
  "creationInfo",
  "lastUpdateInfo",
  "logo",
  "logoType",
]);
const EMPTIED_LISTS = new Set(["watchList", "pendingTransactions", "pendingTransactionIds"]);
// The shape check's own lists, written out in full so the check doesn't weaken along with the scrub.
const FORBIDDEN_KEYS = new Set([
  "draftStrategy",
  "draftList",
  "futureKeeperPlayerIds",
  "notificationSettings",
  "creationInfo",
  "lastUpdateInfo",
  "clientAddress",
  "logo",
  "logoType",
]);
const MUST_BE_EMPTY = new Set(["watchList", "pendingTransactions", "pendingTransactionIds"]);
// Owner-only fields appear on the owner's team alone, so these markers are the only team fields
// allowed to differ between teams.
const OWNER_MARKERS = new Set(["watchList", "pendingTransactions"]);
const MEMBER_FIELDS = new Set([
  "id",
  "firstName",
  "lastName",
  "displayName",
  "isLeagueManager",
  "isLeagueCreator",
]);
// Top-level fields of ESPN league responses. The game and season roots have none of them, and the
// pro schedule has `settings` but no `id`.
const LEAGUE_BODY_KEYS = ["members", "teams", "schedule", "status", "settings"];
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

function childPath(path: string, key: string): string {
  if (!PRINTABLE_KEY.test(key)) return `${path}[<key>]`;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function printableKey(key: string): string {
  return PRINTABLE_KEY.test(key) ? key : "<key>";
}

function matchesOf(text: string, globalPattern: RegExp): readonly string[] {
  return text.match(globalPattern) ?? [];
}

function normalizeMemberId(id: string): string {
  return id.replace(/[{}]/g, "").toUpperCase();
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function placeholderCore(memberNumber: number): string {
  return `00000000-0000-0000-0000-${String(memberNumber).padStart(12, "0")}`;
}

export function placeholderMemberId(memberNumber: number): string {
  return `{${placeholderCore(memberNumber)}}`;
}

function unrecognized(message: string): EspnError {
  return new EspnError("unrecognized_response", message);
}

// Without every member and team, the guard can't recognize their values, so it refuses rather than
// passing a recording it can't check. The message gives counts, never values.
function assertCompleteIdentities(identities: RecordingIdentities): void {
  const memberIds = new Set(identities.members.map((member) => normalizeMemberId(member.id)));
  const owners = identities.teams.flatMap((team) => [...team.owners, team.primaryOwner ?? ""]);
  const unlisted = owners.filter((owner) => owner && !memberIds.has(normalizeMemberId(owner)));
  const missingIds = identities.members.filter((member) => !member.id.trim()).length;
  const hasName = identities.leagueName.trim() !== "";
  const hasCookie = identities.espnS2.trim() !== "";
  const complete =
    identities.members.length > 0 &&
    identities.teams.length > 0 &&
    unlisted.length === 0 &&
    missingIds === 0 &&
    hasName &&
    hasCookie;
  if (complete) return;
  throw unrecognized(
    `can't check a recording against incomplete league identities: ${identities.members.length} members, ` +
      `${identities.teams.length} teams, ${unlisted.length} team owners not among the members, ` +
      `${missingIds} members without an id, league name ${hasName ? "present" : "missing"}, ` +
      `espn_s2 ${hasCookie ? "present" : "missing"}`
  );
}

function objectOrThrow(value: unknown, what: string, key: string): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw unrecognized(`can't check ${what} ${printableKey(key)}: it isn't a JSON object`);
}

// Member N is the primary owner (or else the first owner) of team N, so the recorded league stays
// coherent. Members who own no team are numbered after the highest team id.
function numberMembers(identities: RecordingIdentities): Map<string, number> {
  const numbers = new Map<string, number>();
  const teams = [...identities.teams].sort((a, b) => a.id - b.id);
  for (const team of teams) {
    const owner = team.primaryOwner ?? team.owners[0];
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
  const dashless = new Map([...numbers].map(([id, n]) => [id.replace(/-/g, ""), n]));
  return (text) =>
    text
      .replace(MEMBER_ID_PATTERN, (core) => {
        const memberNumber = numbers.get(core.toUpperCase());
        return memberNumber === undefined ? core : placeholderCore(memberNumber);
      })
      .replace(DASHLESS_ID_PATTERN, (core) => {
        const memberNumber = dashless.get(core.toUpperCase());
        return memberNumber === undefined ? core : placeholderCore(memberNumber).replace(/-/g, "");
      });
}

// A member is rebuilt from the fields known to be safe once replaced, so an unexpected personal
// field (an email, say) never passes through.
function scrubMember(member: unknown, numbers: Map<string, number>): Record<string, unknown> {
  const id = isRecord(member) && typeof member.id === "string" ? member.id : "";
  const memberNumber = numbers.get(normalizeMemberId(id));
  if (!isRecord(member) || memberNumber === undefined) {
    throw unrecognized("a recording lists a member that isn't among the league's identities");
  }
  const scrubbed: Record<string, unknown> = { id };
  if ("firstName" in member) scrubbed.firstName = "Member";
  if ("lastName" in member) scrubbed.lastName = String(memberNumber);
  if ("displayName" in member) scrubbed.displayName = `member-${memberNumber}`;
  for (const flag of ["isLeagueManager", "isLeagueCreator"]) {
    if (typeof member[flag] === "boolean") scrubbed[flag] = member[flag];
  }
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

function scrubBodyFields(
  body: Record<string, unknown>,
  identities: RecordingIdentities,
  numbers: Map<string, number>
): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = { ...body };
  if (body.id === identities.leagueId) scrubbed.id = RECORDED_LEAGUE_ID;
  if (isRecord(body.settings) && "name" in body.settings) {
    scrubbed.settings = { ...body.settings, name: RECORDED_LEAGUE_NAME };
  }
  if (Array.isArray(body.members)) {
    scrubbed.members = body.members.map((member) => scrubMember(member, numbers));
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

// Returns the bodies under the same keys, with placeholders: Member N, member-n and
// {00000000-0000-0000-0000-0000000000NN} for the owner of team N; Team N and TN for team N; league
// id 0 and "Recorded League". Calls given the same identities give the same placeholders.
export function scrubRecording(
  bodies: Record<string, unknown>,
  identities: RecordingIdentities
): Record<string, unknown> {
  assertCompleteIdentities(identities);
  const numbers = numberMembers(identities);
  const replaceMemberIds = memberIdReplacer(numbers);
  return Object.fromEntries(
    Object.entries(bodies).map(([key, body]) => [
      key,
      scrubNode(
        scrubBodyFields(objectOrThrow(body, "recorded body", key), identities, numbers),
        replaceMemberIds
      ),
    ])
  );
}

type IdentityMatcher = { kind: IdentifyingValueKind; matches: (text: string) => boolean };

function cookieForms(espnS2: string): string[] {
  try {
    return [...new Set([espnS2, decodeURIComponent(espnS2)])];
  } catch (error) {
    if (error instanceof URIError) return [espnS2];
    throw error;
  }
}

function wordPattern(normalized: string): RegExp {
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u");
}

// A real value that already looks like its placeholder can't identify anyone, so it isn't matched.
function matchTarget(value: string, placeholder: RegExp): string | null {
  const normalized = normalizeText(value);
  return normalized && !placeholder.test(normalized) ? normalized : null;
}

function wholeValueMatcher(
  kind: IdentifyingValueKind,
  value: string,
  placeholder: RegExp
): IdentityMatcher[] {
  const target = matchTarget(value, placeholder);
  return target ? [{ kind, matches: (text) => normalizeText(text) === target }] : [];
}

function wholeWordsMatcher(
  kind: IdentifyingValueKind,
  value: string,
  placeholder: RegExp
): IdentityMatcher[] {
  const target = matchTarget(value, placeholder);
  if (!target) return [];
  const pattern = wordPattern(target);
  return [{ kind, matches: (text) => pattern.test(normalizeText(text)) }];
}

function memberMatchers(member: RecordingMember): IdentityMatcher[] {
  const id = normalizeMemberId(member.id).toLowerCase();
  const fullName = `${member.firstName.trim()} ${member.lastName.trim()}`;
  return [
    ...[id, id.replace(/-/g, "")].map(
      (form): IdentityMatcher => ({
        kind: "member id",
        matches: (text) => text.toLowerCase().includes(form),
      })
    ),
    ...wholeValueMatcher("member name", member.firstName, /^member$/),
    ...wholeValueMatcher("member name", member.lastName, /^\d+$/),
    ...wholeWordsMatcher("display name", member.displayName, /^member-\d+$/),
    ...(member.firstName.trim() && member.lastName.trim()
      ? wholeWordsMatcher("member full name", fullName, /^member \d+$/)
      : []),
  ];
}

// A member's first or last name matches only as a whole value, because members' names occur
// inside NBA players' names; so does a team abbreviation, which can equal a first name. Full
// names, display names, team names and the league name match as whole words anywhere in a string
// (the 2026-10-25 survey found none outside their own fields). Ids, the cookie and the league id
// match anywhere.
function buildMatchers(identities: RecordingIdentities): IdentityMatcher[] {
  const leagueId = String(identities.leagueId);
  return [
    ...identities.members.flatMap(memberMatchers),
    ...identities.teams.flatMap((team) => [
      ...wholeWordsMatcher("team name", team.name, /^team \d+$/),
      ...wholeValueMatcher("team abbreviation", team.abbrev, /^t\d+$/),
    ]),
    ...wholeWordsMatcher("league name", identities.leagueName, /^recorded league$/),
    ...cookieForms(identities.espnS2).map(
      (cookie): IdentityMatcher => ({
        kind: "espn_s2",
        matches: (text) => text.includes(cookie),
      })
    ),
    { kind: "league id", matches: (text) => matchesOf(text, /\d+/g).includes(leagueId) },
  ];
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
  assertCompleteIdentities(identities);
  const matchers = buildMatchers(identities);
  const found: IdentifyingValue[] = [];
  for (const [file, content] of Object.entries(files)) {
    findInNode(
      objectOrThrow(content, "recording file", file),
      "$",
      identities,
      matchers,
      (path, kind) => found.push({ file, path, kind })
    );
  }
  return found;
}

function textProblem(text: string): string | null {
  const dashed = matchesOf(text, MEMBER_ID_PATTERN).some((core) => !PLACEHOLDER_ID_CORE.test(core));
  const dashless = matchesOf(text, DASHLESS_ID_PATTERN).some(
    (core) => !PLACEHOLDER_DASHLESS_CORE.test(core)
  );
  if (dashed || dashless) return "a member id that isn't a placeholder";
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

function checkMember(member: unknown, path: string, report: Report): void {
  if (!isRecord(member)) return;
  for (const key of Object.keys(member)) {
    if (!MEMBER_FIELDS.has(key))
      report(childPath(path, key), "a member field that's never recorded");
  }
  if (!(typeof member.id === "string" && PLACEHOLDER_MEMBER_ID.test(member.id))) {
    report(`${path}.id`, "a member id that isn't a placeholder");
  }
  checkPlaceholders(member, path, MEMBER_PLACEHOLDERS, report);
}

function checkTeams(teams: readonly unknown[], path: string, report: Report): void {
  const records = teams.filter(isRecord);
  const counts = new Map<string, number>();
  for (const team of records)
    for (const key of Object.keys(team)) counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const [key, count] of counts) {
    if (count < records.length && !OWNER_MARKERS.has(key)) {
      report(path, `a team field only some teams have: ${printableKey(key)}`);
    }
  }
  teams.forEach((team, index) =>
    checkPlaceholders(team, `${path}[${index}]`, TEAM_PLACEHOLDERS, report)
  );
}

// A body is a value directly under a request key. Its league id, league name, members and teams
// are checked by field name, whatever else the request schema kept.
function checkBody(body: Record<string, unknown>, path: string, report: Report): void {
  const isLeagueBody = LEAGUE_BODY_KEYS.some((key) => key in body);
  if (isLeagueBody && "id" in body && body.id !== RECORDED_LEAGUE_ID) {
    report(`${path}.id`, "a league id other than the placeholder");
  }
  if (
    isRecord(body.settings) &&
    "name" in body.settings &&
    body.settings.name !== RECORDED_LEAGUE_NAME
  ) {
    report(`${path}.settings.name`, "a league name other than the placeholder");
  }
  if (Array.isArray(body.members)) {
    body.members.forEach((member, index) =>
      checkMember(member, `${path}.members[${index}]`, report)
    );
  }
  if (Array.isArray(body.teams)) checkTeams(body.teams, `${path}.teams`, report);
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
  for (const [key, value] of Object.entries(node)) {
    const keyProblem = textProblem(key);
    const at = keyProblem ? `${path}[<key>]` : childPath(path, key);
    if (keyProblem) report(at, `a key with ${keyProblem}`);
    if (FORBIDDEN_KEYS.has(key)) report(at, `a ${key} field, which is never recorded`);
    if (MUST_BE_EMPTY.has(key) && !(Array.isArray(value) && value.length === 0)) {
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
    const report: Report = (path, problem) => problems.push({ file, path, problem });
    const recording = objectOrThrow(content, "recording file", file);
    checkNode(recording, "$", report);
    for (const [key, body] of Object.entries(recording)) {
      if (isRecord(body)) checkBody(body, childPath("$", key), report);
    }
  }
  return problems;
}

// A scan of JSON text for keys repeated within one object, which JSON.parse would hide.
type KeyScan = { text: string; at: number; found: string[] };

const JSON_SPACE = new Set([" ", "\t", "\n", "\r"]);
const LITERAL_END = new Set([",", ":", "]", "}", ...JSON_SPACE]);

function scanFailure(scan: KeyScan, expected: string): EspnError {
  return unrecognized(`can't scan for duplicate keys: expected ${expected} at offset ${scan.at}`);
}

function skipSpace(scan: KeyScan): void {
  while (JSON_SPACE.has(scan.text[scan.at] ?? "")) scan.at += 1;
}

function nextIs(scan: KeyScan, char: string): boolean {
  skipSpace(scan);
  return scan.text[scan.at] === char;
}

function consume(scan: KeyScan, char: string): boolean {
  if (!nextIs(scan, char)) return false;
  scan.at += 1;
  return true;
}

function expectChar(scan: KeyScan, char: string): void {
  if (!consume(scan, char)) throw scanFailure(scan, `"${char}"`);
}

// The string at the scan's position, decoded as JSON.parse decodes it, so an escaped spelling of a
// key is the same key. A SyntaxError isn't kept as the cause: its message can quote the text.
function readString(scan: KeyScan): string {
  const start = scan.at;
  if (scan.text[start] !== '"') throw scanFailure(scan, "a string");
  let end = start + 1;
  while (end < scan.text.length && scan.text[end] !== '"') end += scan.text[end] === "\\" ? 2 : 1;
  if (end >= scan.text.length) throw scanFailure(scan, "the end of a string");
  scan.at = end + 1;
  try {
    const decoded: unknown = JSON.parse(scan.text.slice(start, end + 1));
    if (typeof decoded === "string") return decoded;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  throw scanFailure(scan, "a JSON string");
}

function skipLiteral(scan: KeyScan): void {
  const start = scan.at;
  while (scan.at < scan.text.length && !LITERAL_END.has(scan.text[scan.at] ?? "")) scan.at += 1;
  if (scan.at === start) throw scanFailure(scan, "a value");
}

function scanValue(scan: KeyScan, path: string): void {
  skipSpace(scan);
  const next = scan.text[scan.at];
  if (next === "{") scanObject(scan, path);
  else if (next === "[") scanArray(scan, path);
  else if (next === '"') readString(scan);
  else skipLiteral(scan);
}

function scanObject(scan: KeyScan, path: string): void {
  expectChar(scan, "{");
  const seen = new Set<string>();
  const repeated = new Set<string>();
  let more = !nextIs(scan, "}");
  while (more) {
    skipSpace(scan);
    const key = readString(scan);
    // As the shape check prints it: a key shaped like a member id or the cookie shows as [<key>].
    const keyPath = textProblem(key) ? `${path}[<key>]` : childPath(path, key);
    if (seen.has(key) && !repeated.has(key)) {
      repeated.add(key);
      scan.found.push(keyPath);
    }
    seen.add(key);
    expectChar(scan, ":");
    scanValue(scan, keyPath);
    more = consume(scan, ",");
  }
  expectChar(scan, "}");
}

function scanArray(scan: KeyScan, path: string): void {
  expectChar(scan, "[");
  let more = !nextIs(scan, "]");
  for (let index = 0; more; index += 1) {
    scanValue(scan, `${path}[${index}]`);
    more = consume(scan, ",");
  }
  expectChar(scan, "]");
}

// Each key a JSON text repeats within one object, once per object, by its path. JSON.parse keeps
// only a repeated key's last value, so a value behind an earlier one would pass every check made
// on the parsed file; this reads the text. It reports where, never a value.
export function findDuplicateKeys(text: string): string[] {
  const scan: KeyScan = { text, at: 0, found: [] };
  scanValue(scan, "$");
  skipSpace(scan);
  if (scan.at !== text.length) throw scanFailure(scan, "the end of the text");
  return scan.found;
}
