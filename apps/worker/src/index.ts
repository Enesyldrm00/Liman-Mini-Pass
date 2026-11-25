// Placeholder worker: stays alive until the BullMQ processor arrives in 1.3.

console.log("worker started, waiting for jobs (none yet)");

const keepAlive = setInterval(() => undefined, 60_000);

function shutdown(signal: string): void {
  console.log(`worker received ${signal}, shutting down`);
  clearInterval(keepAlive);
  process.exit(0);
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
