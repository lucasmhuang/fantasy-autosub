// Tests must not reach a real service, so every test file starts with this guard in place of fetch.
// A test that needs HTTP stubs fetch with vi.stubGlobal; vi.unstubAllGlobals() brings the guard back.
globalThis.fetch = async (input) => {
  const url = input instanceof Request ? input.url : String(input);
  throw new Error(`tests must not reach the network: ${url}`);
};

// Code under test that builds a database connection from the app's settings or pg's own defaults
// gets a dead local port instead, whatever the shell holds: never a hosted database, the dev
// database, or another project's server on 5432. It's 127.0.0.2 because under WSL's mirrored
// networking a closed port on 127.0.0.1 never answers, so a connect there would hang, not fail.
process.env.DATABASE_URL = "postgres://use-the-test-database-fixture@127.0.0.2:1/none";
process.env.PGHOST = "127.0.0.2";
process.env.PGPORT = "1";
