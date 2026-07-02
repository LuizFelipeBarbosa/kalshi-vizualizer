import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The FastAPI app (uv run main.py visualize serve) owns /api; the dev and preview
// servers proxy to it so the frontend can be developed against the real dataset.
const API_PROXY = { "/api": "http://127.0.0.1:8000" };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: API_PROXY },
  preview: { proxy: API_PROXY },
});
