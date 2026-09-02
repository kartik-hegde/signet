import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/v1/traces": "http://localhost:4318",
    },
  },
});
