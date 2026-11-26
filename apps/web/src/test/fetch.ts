import { vi } from "vitest";

export interface FakeResponse {
  status?: number;
  body?: unknown;
}

export type Routes = Record<string, FakeResponse | (() => FakeResponse)>;

function pathOf(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

/**
 * Replaces `fetch` with a stub that answers by `METHOD path` (e.g. `GET /api/me`).
 * Unknown routes answer 404 with the API's error shape. Returns the mock to assert calls.
 */
export function stubFetch(routes: Routes) {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${pathOf(input)}`;
    const route = routes[key];
    const answer = typeof route === "function" ? route() : route;
    const response = answer ?? apiError(404, "not_found", `No stub for ${key}`);
    const { status = 200, body } = response;
    return Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

export function apiError(status: number, code: string, message = code): FakeResponse {
  return { status, body: { error: { code, message } } };
}
