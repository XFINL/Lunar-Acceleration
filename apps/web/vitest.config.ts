import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@lunar/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['test/ui/**/*.test.tsx'],
    setupFiles: ['./test/ui/setup.ts'],
    clearMocks: true,
    maxWorkers: 1,
  },
})
