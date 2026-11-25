import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "pino";
import { pinoHttp, type HttpLogger } from "pino-http";

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Incoming IDs are reused only when they are short and plain, so a client cannot inject
 * control characters or fake fields into log lines.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Path without the query string. */
function pathOf(url: string | undefined): string {
  return (url ?? "").split("?", 1)[0] ?? "";
}

export function resolveRequestId(incoming: string | string[] | undefined): string {
  return typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

/** Assigns every request an ID, echoes it in `X-Request-Id` and logs one line per response. */
export function requestLogger(logger: Logger): HttpLogger {
  return pinoHttp({
    logger,
    genReqId(req: IncomingMessage, res: ServerResponse) {
      const id = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
      res.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
    // Bound to `req.log`, so every line logged while handling the request carries the ID.
    customProps: (req) => ({ reqId: req.id }),
    customLogLevel(_req, res, error) {
      if (error !== undefined || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    // Query strings can carry one-time secrets (the OAuth `code` and `state` in 0.7), so
    // only the path is logged.
    serializers: {
      req: (req: { url?: string; query?: unknown }) => ({
        ...req,
        url: pathOf(req.url),
        query: undefined,
      }),
    },
    // The compose health check hits /healthz every few seconds.
    autoLogging: { ignore: (req) => pathOf(req.url) === "/healthz" },
  });
}
