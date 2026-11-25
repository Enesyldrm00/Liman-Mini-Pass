import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // Requests arrive through Traefik with this Host header.
    allowedHosts: ["liman.localhost"],
  },
});
