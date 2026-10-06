import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Where the dev proxy sends store API calls: the API's dev port unless
// API_PROXY_TARGET says otherwise (e.g. an e2e run on other ports).
const API_TARGET = process.env.API_PROXY_TARGET || "http://localhost:3000";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  base: "/",
  build: {
    outDir: "dist",
    target: "es2022",
    minify: true,
  },
  server: {
    port: 5174,
    proxy: {
      // Proxy API calls to the backend — store runs on its own subdomain,
      // so the slug is at the root: /<slug>/catalog.json (not /store/<slug>/...)
      // But the API endpoints still use /store/ prefix on the backend
      "^/[^/]+/catalog\\.json": { target: API_TARGET, changeOrigin: true, rewrite: (path) => `/store${path}` },
      "^/[^/]+/policies\\.json": { target: API_TARGET, changeOrigin: true, rewrite: (path) => `/store${path}` },
      "^/[^/]+/order$": { target: API_TARGET, changeOrigin: true, rewrite: (path) => `/store${path}` },
      "^/[^/]+/identify$": { target: API_TARGET, changeOrigin: true, rewrite: (path) => `/store${path}` },
      // An order's status (JSON) shares its path with the order page the browser opens, so a
      // browser navigation (Accept: text/html) is served by the app and only the fetch is proxied.
      "^/[^/]+/order/[^/?]+(/pay)?(\\?.*)?$": {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path) => `/store${path}`,
        bypass: (req) => (req.headers.accept?.includes("text/html") ? req.url : undefined),
      },
    },
  },
});
