import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // `server-only` throws on import outside a React Server Component build.
      // Under Vitest the default export condition applies, so a server module
      // could not be unit-tested at all without this. The marker still does its
      // real job in `next build`, which uses the react-server condition.
      // Aliased by absolute path, not by specifier: the package's `exports`
      // field does not expose ./empty.js, so a bare specifier fails to resolve.
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['lib/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts'],
      exclude: ['lib/db/types.ts'],
    },
  },
})
