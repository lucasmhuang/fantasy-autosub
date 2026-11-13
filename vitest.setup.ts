import { release } from "node:os";

// Tests must not reach a real service, so every test file starts with this guard in place of fetch.
// A test that needs HTTP stubs fetch with vi.stubGlobal; vi.unstubAllGlobals() brings the guard back.
globalThis.fetch = async (input) => {
  const url = input instanceof Request ? input.url : String(input);
  throw new Error(`tests must not reach the network: ${url}`);
};

// Code under test that builds a database connection from the app's settings or pg's own defaults
// gets a dead local port instead, whatever the shell holds: never a hosted database, the dev
// database, or another project's server on 5432. Tests that need a dead address of their own build
// it from PGHOST. A closed port on 127.0.0.1 refuses at once, except under WSL's mirrored
// networking, where a connect there never answers, so it would hang, not fail. WSL gets 127.0.0.2,
// which refuses at once on any Linux but hangs on macOS, whose loopback holds only 127.0.0.1.
const deadHost = /microsoft/i.test(release()) ? "127.0.0.2" : "127.0.0.1";
process.env.DATABASE_URL = `postgres://use-the-test-database-fixture@${deadHost}:1/none`;
process.env.PGHOST = deadHost;
process.env.PGPORT = "1";
