import { createServer } from "node:http";

// Minimal placeholder until Express arrives (0.5 / 0.7): it only answers health checks
// so the local stack can be wired up and verified.

const port = Number(process.env.PORT ?? 3000);

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`api listening on :${String(port)}`);
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
