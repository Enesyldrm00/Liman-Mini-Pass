import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Bundle workspace packages from source, so the panel does not need them built first.
  resolve: { conditions: ["liman-source", ...defaultClientConditions] },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // Requests arrive through Traefik with this Host header.
    allowedHosts: ["liman.localhost"],
    // The browser reaches the dev server through Traefik on port 80, not 5173.
    hmr: { clientPort: 80 },
  },
});
