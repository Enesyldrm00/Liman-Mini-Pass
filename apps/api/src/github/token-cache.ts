export interface ExpiringToken {
  readonly token: string;
  readonly expiresAt: Date;
}

export interface TokenCache {
  /** A token for `key` that is valid for at least the refresh margin. */
  get(key: number): Promise<string>;
  /** Forget the cached token for `key`, e.g. after GitHub rejected it. */
  invalidate(key: number): void;
}

export interface TokenCacheOptions {
  /** Fetches a fresh token. Its failures are passed to the caller and never cached. */
  mint: (key: number) => Promise<ExpiringToken>;
  /** A token this close to expiry is replaced before use. */
  refreshBeforeMs: number;
  now?: () => Date;
}

/**
 * In-memory cache of short-lived tokens, one per key. Tokens stay inside this process and
 * are never written to Redis or the database (ADR-0002). Concurrent requests for the same
 * key share one `mint` call instead of each asking GitHub for a token.
 */
export function createTokenCache(options: TokenCacheOptions): TokenCache {
  const now = options.now ?? (() => new Date());
  const cached = new Map<number, ExpiringToken>();
  const pending = new Map<number, Promise<ExpiringToken>>();

  function isFresh(entry: ExpiringToken): boolean {
    return entry.expiresAt.getTime() - now().getTime() > options.refreshBeforeMs;
  }

  function mint(key: number): Promise<ExpiringToken> {
    const request = options
      .mint(key)
      .then((entry) => {
        cached.set(key, entry);
        return entry;
      })
      .finally(() => {
        pending.delete(key);
      });
    pending.set(key, request);
    return request;
  }

  return {
    async get(key) {
      const hit = cached.get(key);
      if (hit && isFresh(hit)) {
        return hit.token;
      }
      cached.delete(key);
      return (await (pending.get(key) ?? mint(key))).token;
    },

    invalidate(key) {
      cached.delete(key);
    },
  };
}
