// The Boarding Pass website: plain HTML pages, built by Vite into dist/.
// The airport map (src/worldmap.svg) is put straight into the page at build
// time, so it shows before any script runs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = import.meta.dirname;
const worldmap = readFileSync(resolve(root, 'src/worldmap.svg'), 'utf8');

export default defineConfig({
  plugins: [
    {
      name: 'inline-worldmap',
      transformIndexHtml: (html) => html.replace('<!--worldmap-->', worldmap),
    },
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        credits: resolve(root, 'credits.html'),
        privacy: resolve(root, 'privacy.html'),
        terms: resolve(root, 'terms.html'),
        cookies: resolve(root, 'cookies.html'),
        accessibility: resolve(root, 'accessibility.html'),
      },
    },
  },
});
