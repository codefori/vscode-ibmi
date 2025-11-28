/// <reference types="vitest" />
import { defineConfig } from 'vite'

export default defineConfig({
  test: { 
    // ... Specify options here.
    root: './src/api/tests',
    globalSetup: [`setup.ts`],
    testTimeout: 120000,
  },
})