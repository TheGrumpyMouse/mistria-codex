import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * The base path.
 *
 * GitHub Pages serves a project site from `/<repo>/`, and every URL in the app
 * is built from `import.meta.env.BASE_URL` because a leading `/` works in dev
 * and 404s in production. `BASE_PATH` lets the deploy workflow set it without
 * this file having to know the repository's name.
 */
const base = process.env.BASE_PATH ?? '/'

/** The repo's own package version, so the About page can name what you're running. */
const pkg = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')) as { version: string }

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // `injectManifest` rather than `generateSW`: the caching rules here are
      // specific enough — versioned-immutable, art-lazy, meta-revalidated —
      // that a generated worker would have to be fought rather than configured.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectManifest: {
        // The shell only. The data bundle and the sprite atlases are cached at
        // runtime, because precaching is all-or-nothing and a single 404 there
        // would stop the worker installing at all.
        globPatterns: ['**/*.{js,css,html,svg,ttf}'],
        globIgnores: ['**/data/**', '**/assets/game/**'],
      },
      manifest: {
        name: 'Mistria Codex',
        short_name: 'Codex',
        description: 'An offline companion for Fields of Mistria.',
        theme_color: '#fbf8f3',
        background_color: '#fbf8f3',
        display: 'standalone',
        // Relative, like every other URL here: an absolute start_url is the
        // same leading-slash bug that 404s on Pages.
        start_url: '.',
        scope: '.',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '~': resolve(here, 'src') },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // Multi-MB JSON parses freeze a mid-range Android for hundreds of
    // milliseconds with no spinner, because React cannot paint either. The
    // budget is a reminder, not a hard cap — but a chunk that crosses it is a
    // decision, not an accident.
    chunkSizeWarningLimit: 500,
    sourcemap: true,
  },
})
