import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // ... Specify options here.
    root: './src/api/tests',
    globalSetup: ['./setup.ts'],
    testTimeout: 120000,
    include: ['suites/**/*.test.ts'],
  },
})
