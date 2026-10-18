import type { BumpyConfig } from '@/config/schema'
import { BumpyConfigSchema } from '@/config/schema'

/**
 * apps/site    -> pricing -> core
 * apps/client  -> presets <-> themes (cycle), pricing (devDependency, npm-style range)
 * apps/admin   -> ui (released), vue (external)
 * packages/ui  -> core
 */
export const workspaceFiles: Record<string, unknown> = {
  'package.json': {
    name: 'root',
    private: true,
    workspaces: ['apps/*', 'packages/*'],
  },
  'apps/site/package.json': {
    name: 'site',
    version: '1.0.0',
    dependencies: { '@acme/pricing': 'workspace:*', 'vue': '^3.5.0' },
  },
  'apps/client/package.json': {
    name: 'client',
    version: '1.0.0',
    dependencies: { '@acme/presets': 'workspace:^' },
    devDependencies: { '@acme/pricing': '*' },
  },
  'apps/admin/package.json': {
    name: 'admin',
    version: '1.0.0',
    dependencies: { '@acme/ui': 'workspace:*', 'vue': '^3.5.0' },
  },
  'packages/pricing/package.json': {
    name: '@acme/pricing',
    private: true,
    dependencies: { '@acme/core': 'workspace:*' },
  },
  'packages/core/package.json': {
    name: '@acme/core',
    private: true,
  },
  'packages/presets/package.json': {
    name: '@acme/presets',
    private: true,
    dependencies: { '@acme/themes': 'workspace:*' },
  },
  'packages/themes/package.json': {
    name: '@acme/themes',
    private: true,
    peerDependencies: { '@acme/presets': 'workspace:*' },
  },
  'packages/ui/package.json': {
    name: '@acme/ui',
    version: '2.0.0',
    dependencies: { '@acme/core': 'workspace:*' },
  },
}

export function makeConfig(
  release: Record<string, unknown> = {},
  rest: Record<string, unknown> = {},
): BumpyConfig {
  return BumpyConfigSchema.parse({
    ...rest,
    release: {
      ignore: ['packages/{pricing,core,presets,themes}/**'],
      ...release,
    },
  })
}
