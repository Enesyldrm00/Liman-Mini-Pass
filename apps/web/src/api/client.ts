import { apiErrorSchema, type ErrorCode } from "@liman/shared";
import type { z } from "zod";

/** A failed API call: the HTTP status and the `error.code` from the body (ROADMAP section 10). */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** True for a 401: the session is missing, expired or revoked. */
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    // Same origin as the panel (Traefik routes /api), so the session cookie goes along.
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiRequestError(0, "internal", "Could not reach the Liman API");
  }
  if (!response.ok) {
    throw await toError(response);
  }
  return response;
}

async function toError(response: Response): Promise<ApiRequestError> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = apiErrorSchema.safeParse(body);
  if (parsed.success) {
    return new ApiRequestError(response.status, parsed.data.error.code, parsed.data.error.message);
  }
  // Not our error shape, e.g. a proxy error page.
  return new ApiRequestError(
    response.status,
    response.status === 401 ? "unauthenticated" : "internal",
    `Request failed with status ${String(response.status)}`,
  );
}

/** GETs `path` and validates the body against `schema`. */
export async function getJson<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  const response = await send(path, { method: "GET" });
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiRequestError(response.status, "internal", "Unexpected response from the API");
  }
  return parsed.data;
}

/** POSTs without a body and ignores the response body (e.g. a 204). */
export async function post(path: string): Promise<void> {
  await send(path, { method: "POST" });
}
