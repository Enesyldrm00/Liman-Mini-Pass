import { createServer } from "node:http";
import { EnvValidationError } from "@liman/shared";
import { loadConfig, type Config } from "./config/index.js";

function readConfig(): Config {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      // No logger yet: the log level itself comes from the config.
      process.stderr.write(`api: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const config = readConfig();

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`api listening on :${String(config.port)}`);
});

function shutdown(signal: string): void {
  console.log(`api received ${signal}, shutting down`);
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
