import type { ApiError } from "@liman/shared";
import express, { type ErrorRequestHandler, type Express } from "express";
import type { Logger } from "pino";
import { requestLogger } from "./middleware/request-logger.js";

export interface AppDeps {
  logger: Logger;
}

export function createApp({ logger }: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestLogger(logger));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

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
    req.log.error({ err: error }, "unhandled error");
    const body: ApiError = { error: { code: "internal", message: "Internal server error" } };
    res.status(500).json(body);
  };
  app.use(handleError);

  return app;
}
