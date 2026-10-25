import { afterEach, describe, expect, it, vi } from "vitest";

// The guard comes from the Vitest setup file (vitest.setup.ts at the repo root), not from an import.
const unreachableUrl = "http://network-guard.invalid/";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("network guard", () => {
  it("rejects a fetch that would reach the network, naming the URL", async () => {
    await expect(fetch(unreachableUrl)).rejects.toThrow(
      `tests must not reach the network: ${unreachableUrl}`
    );
  });

  it("gives way to a stubbed fetch, and returns once the stub is removed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () =>
        Response.json({ stubbed: true })
      )
    );

    const response = await fetch(unreachableUrl);
    expect(await response.json()).toEqual({ stubbed: true });

    vi.unstubAllGlobals();

    await expect(fetch(unreachableUrl)).rejects.toThrow("tests must not reach the network");
  });
});
