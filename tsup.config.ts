import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  clean: true,
  dts: true,
  bundle: true,
  platform: 'node',
  target: 'node20',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [
    'commander',
    '@clack/prompts',
    'zod',
    'semver',
    'execa',
    'picocolors',
    'conventional-commits-parser',
    'fast-glob',
    'js-yaml',
    'node:fs/promises',
    'node:path',
    'node:process',
  ],
})
