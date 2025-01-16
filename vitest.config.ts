/// <reference types="vitest" />
import { defineConfig } from 'vite'

export default defineConfig({
  test: { 
    // ... Specify options here.
    fileParallelism: false,
    root: './src/api',
    setupFiles: [
      'tests/globalSetup.ts',
    ],
    testTimeout: 10000
  },
})