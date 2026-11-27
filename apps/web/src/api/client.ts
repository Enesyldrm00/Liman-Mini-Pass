import { apiErrorSchema, type ErrorCode } from "@liman/shared";
import { z } from "zod";

/** A field-level problem the API reported for a 400 or 409 (`error.details`). */
export interface FieldError {
  path: string;
  message: string;
}

const fieldErrorsSchema = z.array(z.object({ path: z.string(), message: z.string() }));

/** A failed API call: the HTTP status and the `error.code` from the body (ROADMAP section 10). */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fieldErrors: readonly FieldError[] = [],
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
      headers: {
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
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
    const fields = fieldErrorsSchema.safeParse(parsed.data.error.details);
    return new ApiRequestError(
      response.status,
      parsed.data.error.code,
      parsed.data.error.message,
      fields.success ? fields.data : [],
    );
  }
  // Not our error shape, e.g. a proxy error page.
  return new ApiRequestError(
    response.status,
    response.status === 401 ? "unauthenticated" : "internal",
    `Request failed with status ${String(response.status)}`,
  );
}

/** GETs `path` and validates the body against `schema`. */
export function getJson<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
  return sendJson("GET", path, undefined, schema);
}

/** Sends `body` as JSON (if given) and validates the response body against `schema`. */
export async function sendJson<S extends z.ZodType>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body: unknown,
  schema: S,
): Promise<z.infer<S>> {
  const response = await send(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json: unknown = await response.json().catch(() => undefined);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiRequestError(response.status, "internal", "Unexpected response from the API");
  }
  return parsed.data;
}

/** POSTs without a body and ignores the response body (e.g. a 204). */
export async function post(path: string): Promise<void> {
  await send(path, { method: "POST" });
}
