/* eslint-disable node/prefer-global/process */
import type { BumpyConfig } from '@/config/schema'
import fs from 'node:fs/promises'
import path from 'node:path'
import fg from 'fast-glob'
import yaml from 'js-yaml'
import { getRemoteUrl } from '@/git'

export interface Project {
  name: string
  directory: string
  version: string
  packageJsonPath: string
  repoUrl?: string
}

function getRepoUrl(pkg: any): string | undefined {
  let url = ''

  if (typeof pkg === 'string') {
    url = pkg
  }
  else {
    const repo = pkg.repository
    if (!repo)
      return undefined

    if (typeof repo === 'string') {
      url = repo
    }
    else if (typeof repo === 'object' && repo.url) {
      url = repo.url
    }
  }

  if (!url)
    return undefined

  // Clean up URL
  if (url.startsWith('git+'))
    url = url.slice(4)
  if (url.endsWith('.git'))
    url = url.slice(0, -4)
  if (url.startsWith('git://'))
    url = `https://${url.slice(6)}`

  // Handle SSH urls (git@github.com:user/repo)
  if (url.startsWith('git@')) {
    const match = url.match(/^git@([^:]+):(.*)$/)
    if (match) {
      return `https://${match[1]}/${match[2]}`
    }
  }

  // Handle github shorthand "user/repo"
  if (!url.includes('://') && url.split('/').length === 2) {
    return `https://github.com/${url}`
  }

  return url
}

async function getWorkspacePatterns(
  cwd: string,
  config: BumpyConfig,
): Promise<string[]> {
  // 1. Config override
  if (config.projects && config.projects.length > 0) {
    return config.projects
  }

  // 2. package.json workspaces
  try {
    const pkgContent = await fs.readFile(
      path.join(cwd, 'package.json'),
      'utf-8',
    )
    const pkg = JSON.parse(pkgContent)
    if (Array.isArray(pkg.workspaces)) {
      return pkg.workspaces
    }
    else if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) {
      return pkg.workspaces.packages
    }
  }
  catch {}

  // 3. pnpm-workspace.yaml
  try {
    const pnpmContent = await fs.readFile(
      path.join(cwd, 'pnpm-workspace.yaml'),
      'utf-8',
    )
    const pnpmConfig = yaml.load(pnpmContent) as any
    if (pnpmConfig && Array.isArray(pnpmConfig.packages)) {
      return pnpmConfig.packages
    }
  }
  catch {}

  // 4. Default
  for (const dir of ['apps', 'packages']) {
    try {
      const stat = await fs.stat(path.join(cwd, dir))
      if (stat.isDirectory())
        return ['apps/*', 'packages/*']
    }
    catch {}
  }

  return ['.']
}

export async function resolveProjects(
  config: BumpyConfig,
  cwd: string = process.cwd(),
): Promise<Project[]> {
  const patterns = await getWorkspacePatterns(cwd, config)

  // Transform patterns to find package.json files
  const manifestPatterns = patterns.map((p) => {
    if (p.endsWith('/package.json'))
      return p
    return `${p.replace(/\/+$/, '')}/package.json`
  })

  const ignore = [
    '**/node_modules/**',
    '**/dist/**',
    '**/test/**',
    '**/tests/**',
  ]

  const entries = await fg(manifestPatterns, {
    cwd,
    ignore: [...ignore, ...config.release.ignore],
    absolute: false,
  })

  // Try to find root package.json for fallback repository
  let rootRepoUrl: string | undefined
  try {
    const rootPkgContent = await fs.readFile(
      path.join(cwd, 'package.json'),
      'utf-8',
    )
    const rootPkg = JSON.parse(rootPkgContent)
    rootRepoUrl = getRepoUrl(rootPkg)
  }
  catch {}

  // If still no repo url, try to get from git remote
  if (!rootRepoUrl) {
    const gitRemote = await getRemoteUrl()
    if (gitRemote) {
      rootRepoUrl = getRepoUrl(gitRemote)
    }
  }

  const projects: Project[] = []

  for (const entry of entries) {
    const pkgPath = path.join(cwd, entry)
    const projectDir = path.dirname(pkgPath)
    const relativeDir = path.relative(cwd, projectDir) || '.'

    try {
      const pkgContent = await fs.readFile(pkgPath, 'utf-8')
      const pkg = JSON.parse(pkgContent)

      if (!pkg.name)
        continue

      const repoUrl = getRepoUrl(pkg) || rootRepoUrl

      projects.push({
        name: pkg.name,
        directory: relativeDir,
        version: pkg.version || '0.0.0',
        packageJsonPath: pkgPath,
        repoUrl,
      })
    }
    catch {
      // invalid package.json, skip
    }
  }

  return projects
}
