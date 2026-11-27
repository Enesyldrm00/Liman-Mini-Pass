import { githubInstallations, type Database } from "@liman/db";
import type { ApiError, ErrorCode } from "@liman/shared";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import type { z } from "zod";
import { GitHubApiError } from "../github/app.js";

// Small pieces the route modules share. Every helper that "answers" writes the response
// itself and returns null, so a handler can stop with `if (!x) return;`.

export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: unknown,
): void {
  const body: ApiError = { error: { code, message, ...(details ? { details } : {}) } };
  res.status(status).json(body);
}

/**
 * 400 with the failing fields. Only paths and the schemas' own messages are sent back,
 * never the received values: an env value could be a secret.
 */
export function sendValidation(res: Response, message: string, error?: z.ZodError): void {
  const details = error?.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
  sendError(res, 400, "validation_failed", message, details);
}

/** The signed-in user; only call after `requireAuth`. */
export function currentUserId(req: Request): string {
  const id = req.auth?.user.id;
  if (!id) {
    throw new Error("requireAuth let an unauthenticated request through");
  }
  return id;
}

/**
 * Loads the installation (Liman's UUID) and checks the signed-in user owns it and it is
 * not suspended. Answers 404, 403 or 409 and returns null otherwise.
 */
export async function ownedInstallation(db: Database, req: Request, res: Response, id: string) {
  const [row] = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.id, id))
    .limit(1);
  if (!row) {
    sendError(res, 404, "not_found", "Installation not found");
    return null;
  }
  if (row.ownerId !== currentUserId(req)) {
    sendError(res, 403, "forbidden", "Not your installation");
    return null;
  }
  if (row.suspendedAt !== null) {
    sendError(res, 409, "conflict", "Installation is suspended on GitHub");
    return null;
  }
  return row;
}

/** Runs a GitHub call; GitHub failures become a 404, 409 or 502 answer and null. */
export async function callGitHub<T>(
  req: Request,
  res: Response,
  call: () => Promise<T>,
): Promise<T | null> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof GitHubApiError)) {
      throw error;
    }
    req.log.warn({ reason: error.reason, status: error.status }, "github api call failed");
    if (error.reason === "installation_token_http_404") {
      // Uninstalled on GitHub; the row goes at the next sign-in (webhooks in 1.2).
      sendError(res, 404, "not_found", "Installation no longer exists on GitHub");
    } else if (error.reason === "installation_token_http_403") {
      // Suspended on GitHub since the last sign-in; `suspended_at` catches up then.
      sendError(res, 409, "conflict", "Installation is suspended on GitHub");
    } else if (error.reason === "installation_repos_too_many") {
      sendError(
        res,
        409,
        "conflict",
        "Installation has too many repositories; select fewer on GitHub",
      );
    } else {
      sendError(res, 502, "upstream_failed", "GitHub request failed");
    }
    return null;
  }
}

/** The Postgres error code under a Drizzle query error, if there is one. */
export function postgresCode(error: unknown): string | undefined {
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  const code: unknown =
    cause && typeof cause === "object" ? (cause as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : undefined;
}

/** The constraint name under a Drizzle query error, if there is one. */
export function postgresConstraint(error: unknown): string | undefined {
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  const name: unknown =
    cause && typeof cause === "object" ? (cause as { constraint?: unknown }).constraint : undefined;
  return typeof name === "string" ? name : undefined;
}
