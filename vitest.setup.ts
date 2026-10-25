// Tests must not reach a real service, so every test file starts with this guard in place of fetch.
// A test that needs HTTP stubs fetch with vi.stubGlobal; vi.unstubAllGlobals() brings the guard back.
globalThis.fetch = async (input) => {
  const url = input instanceof Request ? input.url : String(input);
  throw new Error(`tests must not reach the network: ${url}`);
};
