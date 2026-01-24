/* eslint-disable node/prefer-global/process */
import type { BumpyConfig } from '@/config/schema'
import fs from 'node:fs/promises'
import path from 'node:path'
import { BumpyConfigSchema } from '@/config/schema'

export const DEFAULT_CONFIG: BumpyConfig = {
  release: {
    ignore: [],
    changelog: {
      projectChangelogs: true,
      workspaceChangelog: false,
    },
    git: {
      commit: true,
      tag: true,
      push: true,
      commitMessage: 'chore(release): {tag}',
    },
  },
}

export async function loadConfig(
  cwd: string = process.cwd(),
): Promise<BumpyConfig> {
  const configPath = path.join(cwd, 'bumpy.json')
  try {
    const content = await fs.readFile(configPath, 'utf-8')
    const json = JSON.parse(content)
    return BumpyConfigSchema.parse(json)
  }
  catch (error: any) {
    if (error.code === 'ENOENT') {
      return DEFAULT_CONFIG
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse bumpy.json: ${error.message}`)
    }
    throw error
  }
}

export async function initConfig(cwd: string = process.cwd()): Promise<void> {
  const configPath = path.join(cwd, 'bumpy.json')

  try {
    await fs.access(configPath)
    throw new Error('bumpy.json already exists.')
  }
  catch (error: any) {
    if (error.code !== 'ENOENT')
      throw error
  }

  await fs.writeFile(
    configPath,
    JSON.stringify(DEFAULT_CONFIG, null, 2),
    'utf-8',
  )
}
