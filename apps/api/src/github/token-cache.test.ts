import { describe, expect, it } from "vitest";
import { createTokenCache, type ExpiringToken } from "./token-cache.js";

const MINUTE = 60 * 1000;

/** A cache over a fake mint that hands out `token-1`, `token-2`, … valid for an hour. */
function setup(start = new Date("2026-11-26T12:00:00Z")) {
  const clock = { now: start };
  const minted: number[] = [];
  let failNext = false;
  const cache = createTokenCache({
    refreshBeforeMs: 5 * MINUTE,
    now: () => clock.now,
    mint: (key) => {
      minted.push(key);
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error("mint failed"));
      }
      const entry: ExpiringToken = {
        token: `token-${String(minted.length)}`,
        expiresAt: new Date(clock.now.getTime() + 60 * MINUTE),
      };
      return Promise.resolve(entry);
    },
  });
  return {
    cache,
    minted,
    advance: (ms: number) => {
      clock.now = new Date(clock.now.getTime() + ms);
    },
    failOnce: () => {
      failNext = true;
    },
  };
}

describe("token cache", () => {
  it("reuses a token while it is fresh", async () => {
    const { cache, minted, advance } = setup();
    expect(await cache.get(1)).toBe("token-1");
    advance(50 * MINUTE);
    expect(await cache.get(1)).toBe("token-1");
    expect(minted).toEqual([1]);
  });

  it("replaces a token 5 minutes before it expires", async () => {
    const { cache, minted, advance } = setup();
    await cache.get(1);
    advance(55 * MINUTE); // exactly 5 minutes left
    expect(await cache.get(1)).toBe("token-2");
    expect(minted).toEqual([1, 1]);
  });

  it("keeps a separate token per installation", async () => {
    const { cache, minted } = setup();
    expect(await cache.get(1)).toBe("token-1");
    expect(await cache.get(2)).toBe("token-2");
    expect(await cache.get(1)).toBe("token-1");
    expect(minted).toEqual([1, 2]);
  });

  it("shares one mint between concurrent requests", async () => {
    const { cache, minted } = setup();
    const tokens = await Promise.all([cache.get(1), cache.get(1), cache.get(1)]);
    expect(tokens).toEqual(["token-1", "token-1", "token-1"]);
    expect(minted).toEqual([1]);
  });

  it("does not cache a failure", async () => {
    const { cache, minted, failOnce } = setup();
    failOnce();
    await expect(cache.get(1)).rejects.toThrow("mint failed");
    expect(await cache.get(1)).toBe("token-2");
    expect(minted).toEqual([1, 1]);
  });

  it("mints again after invalidate", async () => {
    const { cache, minted } = setup();
    await cache.get(1);
    cache.invalidate(1);
    expect(await cache.get(1)).toBe("token-2");
    expect(minted).toEqual([1, 1]);
  });
});
