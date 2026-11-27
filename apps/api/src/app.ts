import type { ApiError } from "@liman/shared";
import express, { type ErrorRequestHandler, type Express } from "express";
import type { Logger } from "pino";
import { requestLogger } from "./middleware/request-logger.js";
import { safeError } from "./safe-error.js";

export interface AppDeps {
  logger: Logger;
  /** Mounts feature routes before the 404 and error handlers. */
  registerRoutes?: (app: Express) => void;
}

const BODY_PARSER_ERRORS = new Set([
  "entity.parse.failed",
  "entity.too.large",
  "encoding.unsupported",
  "charset.unsupported",
  "request.aborted",
  "request.size.invalid",
  "stream.encoding.set",
]);

/** The `type` body-parser puts on its errors, if this is one of them. */
function bodyParserErrorType(error: unknown): string | undefined {
  const type: unknown =
    error && typeof error === "object" ? (error as { type?: unknown }).type : undefined;
  return typeof type === "string" && BODY_PARSER_ERRORS.has(type) ? type : undefined;
}

export function createApp({ logger, registerRoutes }: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  // Exactly one proxy (Traefik) sits in front of the API, so req.ip is the address Traefik
  // saw. Trusting more hops would let clients pick their own IP via X-Forwarded-For and
  // dodge the sign-in rate limit.
  app.set("trust proxy", 1);
  app.use(requestLogger(logger));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  registerRoutes?.(app);

  app.use((_req, res) => {
    const body: ApiError = { error: { code: "not_found", message: "Not found" } };
    res.status(404).json(body);
  });

  // Express 5 forwards rejected promises from async handlers here as well.
  const handleError: ErrorRequestHandler = (error: unknown, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    // express.json(): malformed JSON or a body over the route's limit. Its message can
    // quote part of the body, so a fixed message is sent and nothing of it is logged.
    const parserType = bodyParserErrorType(error);
    if (parserType) {
      const tooLarge = parserType === "entity.too.large";
      const body: ApiError = {
        error: {
          code: "validation_failed",
          message: tooLarge ? "Request body is too large" : "Request body is not valid JSON",
        },
      };
      req.log.warn({ type: parserType }, "rejected request body");
      res.status(tooLarge ? 413 : 400).json(body);
      return;
    }
    req.log.error({ err: safeError(error) }, "unhandled error");
    const body: ApiError = { error: { code: "internal", message: "Internal server error" } };
    res.status(500).json(body);
  };
  app.use(handleError);

  return app;
}
