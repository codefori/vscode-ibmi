/// <reference types="vitest" />
import { defineConfig } from 'vite'

export default defineConfig({
  test: { 
    // ... Specify options here.
    fileParallelism: false,
    root: './src/api',
    testTimeout: 10000
  },
})