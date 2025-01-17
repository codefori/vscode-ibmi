/// <reference types="vitest" />
import { defineConfig } from 'vite'

export default defineConfig({
  test: { 
    // ... Specify options here.
    root: './src/api',
    globalSetup: [`tests/setup.ts`],
    testTimeout: 10000,
  },
})