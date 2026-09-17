import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const devHost = process.env.VITE_DEV_HOST || "127.0.0.1";
const devPort = Number(process.env.VITE_DEV_PORT || 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    host: devHost,
    port: devPort,
    strictPort: true,
    ws: {
      protocol: "ws",
      host: devHost,
      port: devPort,
      clientPort: devPort,
    },
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/uploads": "http://127.0.0.1:3001",
      "/game-api": "http://127.0.0.1:3004",
      "/ws": { target: "ws://127.0.0.1:3002", ws: true },
    },
  },
});
