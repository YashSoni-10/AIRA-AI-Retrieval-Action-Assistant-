/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Proxy AI service routes to FastAPI on 127.0.0.1:8000
      // This completely avoids the Windows localhost → ::1 (IPv6) resolution bug.
      "/api/v1": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        // Allow streaming / SSE responses — do not buffer them
        configure: (proxy) => {
          proxy.on("proxyReq", (_proxyReq, req) => {
            // Log proxied SSE requests in dev for easier debugging
            if (req.url?.includes("/chat/stream")) {
              console.log("[vite-proxy] SSE stream →", req.url);
            }
          });
        },
      },
      // Proxy Node backend routes
      "/api/auth": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/test/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", "src/__tests__/**"],
  },
});