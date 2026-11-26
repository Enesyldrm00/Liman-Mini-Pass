// Small helpers shared by the GitHub clients. They turn network failures, timeouts, HTTP
// errors and bad JSON into the caller's own error type with a short reason that is safe to
// log: no URLs with query strings, no headers, no response bodies (which can echo tokens).

export const GITHUB_API = "https://api.github.com";

const TIMEOUT_MS = 10_000;

/** Headers GitHub's REST API expects on every call. */
export const GITHUB_HEADERS = {
  accept: "application/vnd.github+json",
  "user-agent": "liman",
  "x-github-api-version": "2022-11-28",
} as const;

export type ErrorFactory = (reason: string, status?: number) => Error;

export async function githubFetch(
  fetchImpl: typeof fetch,
  what: string,
  url: string,
  init: RequestInit,
  fail: ErrorFactory,
): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw fail(`${what}_${timedOut ? "timeout" : "network"}`);
  }
}

/** The JSON body of a 2xx response; anything else fails with `<what>_http_<status>`. */
export async function readJson(
  response: Response,
  what: string,
  fail: ErrorFactory,
): Promise<unknown> {
  if (!response.ok) {
    // Drain the body so the connection can be reused; its content is not looked at.
    await response.body?.cancel().catch(() => undefined);
    throw fail(`${what}_http_${String(response.status)}`, response.status);
  }
  try {
    return await response.json();
  } catch {
    throw fail(`${what}_invalid_json`, response.status);
  }
}

/** True when a `Link` header has a `rel="next"` entry, i.e. there is another page. */
export function hasNextPage(response: Response): boolean {
  const link = response.headers.get("link");
  return link !== null && /<[^>]*>\s*;\s*rel="next"/.test(link);
}
