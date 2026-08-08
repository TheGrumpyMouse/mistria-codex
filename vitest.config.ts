import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    environment: 'node',
    // The app's own alias, so a test can import the module under the same
    // specifier the source does.
    alias: { '~': new URL('./apps/web/src/', import.meta.url).pathname },
  },
})
