// The admin site (Update A, phase A6): its own small site, deployed as a static Worker (`npm run admin:deploy`) behind
// Cloudflare Access. `npm run admin:dev` (port 1430) and `npm run admin:build` (to admin/dist).
// It borrows the game's painter, aircraft pictures and look, and nothing else.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SUPABASE = 'https://dlgkdknfxhmtkhpegufq.supabase.co';
const WORKER = 'https://bp-logos.boardingpass-game.workers.dev';
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${SUPABASE} ${WORKER}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Cloudflare reads _headers: no framing, no referrer, no caching of the page, and the policy above. */
const headers = {
  name: 'admin-headers',
  apply: 'build' as const,
  generateBundle(this: { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => void }) {
    this.emitFile({
      type: 'asset',
      fileName: '_headers',
      source: `/*\n  Content-Security-Policy: ${CSP}\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`,
    });
  },
};

export default defineConfig({
  root: __dirname,
  // Its own cache, so it can run next to the game's dev server
  cacheDir: '../node_modules/.vite-admin',
  envDir: `${__dirname}/..`,
  publicDir: `${__dirname}/../public`,
  plugins: [react(), headers],
  server: { port: 1430, strictPort: true },
  build: { outDir: `${__dirname}/dist`, emptyOutDir: true },
});
