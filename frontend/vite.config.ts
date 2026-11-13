import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: false },
    },
  },
  build: {
    // 产物直接落到发行目录，后端 release/web 托管，无需二次拷贝
    outDir: "../release/web",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
});
