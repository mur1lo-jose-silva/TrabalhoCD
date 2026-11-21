import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Em desenvolvimento (npm run dev), as chamadas de API sao repassadas ao
// Traefik, como acontece em producao quando tudo roda pelo docker compose.
const GATEWAY = process.env.GATEWAY_URL || "http://127.0.0.1:80";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/produtos": GATEWAY,
      "/estoque": GATEWAY,
      "/alertas": GATEWAY,
    },
  },
});
