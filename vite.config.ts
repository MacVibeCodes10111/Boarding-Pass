import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
// Browser build only (the desktop apps get the same policy from tauri.conf.json):
// a content security policy, so the page only runs its own code and only talks
// to the services it uses (v2.50).
const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.cartocdn.com https://basemaps.cartocdn.com https://tiles.maps.eox.at",
  "font-src 'self' data:",
  "connect-src 'self' https://*.cartocdn.com https://basemaps.cartocdn.com https://tiles.maps.eox.at https://dlgkdknfxhmtkhpegufq.supabase.co",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');
const webCsp = {
  name: 'web-csp',
  apply: 'build' as const,
  transformIndexHtml(html: string) {
    // @ts-expect-error process is a nodejs global
    if (process.env.TAURI_ENV_PLATFORM) return html;
    return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${WEB_CSP}" />`);
  },
};

export default defineConfig(async () => ({
  plugins: [react(), webCsp],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
