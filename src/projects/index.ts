/* eslint-disable node/prefer-global/process */
import type { BumpyConfig, ProjectEntry } from '@/config/schema'
import fs from 'node:fs/promises'
import path from 'node:path'
import fg from 'fast-glob'
import yaml from 'js-yaml'
import { getRemoteUrl } from '@/git'

export interface WorkspacePackage {
  name: string
  directory: string
}

export interface Project {
  name: string
  directory: string
  version: string
  packageJsonPath: string
  repoUrl?: string
  /** Internal (not released) workspace packages this project depends on, transitively. */
  workspaceDeps: WorkspacePackage[]
  /** Extra paths from `projects[].include` whose commits belong to this project. */
  include: string[]
}

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/test/**',
  '**/tests/**',
]

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

async function getPackageManagerPatterns(cwd: string): Promise<string[]> {
  // 1. package.json workspaces
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

  // 2. pnpm-workspace.yaml
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

  // 3. Default
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

async function findManifests(
  cwd: string,
  patterns: string[],
  ignore: string[],
): Promise<string[]> {
  const manifestPatterns = patterns.map((p) => {
    if (p.endsWith('/package.json'))
      return p
    return `${p.replace(/\/+$/, '')}/package.json`
  })

  return fg(manifestPatterns, {
    cwd,
    ignore: [...DEFAULT_IGNORE, ...ignore],
    absolute: false,
  })
}

async function readManifest(pkgPath: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
  }
  catch {
    return null
  }
}

function getDependencyNames(pkg: any): string[] {
  const names = new Set<string>()
  for (const field of DEPENDENCY_FIELDS) {
    const deps = pkg[field]
    if (deps && typeof deps === 'object') {
      for (const name of Object.keys(deps)) names.add(name)
    }
  }
  return [...names]
}

interface ManifestInfo {
  directory: string
  dependencies: string[]
}

/**
 * Collects workspace packages that are excluded from releases (via
 * `release.ignore` or `projects`). Their code ships inside the projects that
 * depend on them, so their commits belong to those projects' history.
 * Released packages have their own versions and changelogs and are not followed.
 */
async function resolveInternalPackages(
  cwd: string,
  patterns: string[],
  releasedNames: Set<string>,
): Promise<Map<string, ManifestInfo>> {
  const entries = await findManifests(cwd, patterns, [])
  const internal = new Map<string, ManifestInfo>()

  for (const entry of entries) {
    const directory = path.dirname(entry)
    // The workspace root would match every commit in the repo
    if (directory === '.')
      continue

    const pkg = await readManifest(path.join(cwd, entry))
    if (!pkg?.name || releasedNames.has(pkg.name))
      continue

    internal.set(pkg.name, {
      directory,
      dependencies: getDependencyNames(pkg),
    })
  }

  return internal
}

function collectWorkspaceDeps(
  pkg: any,
  internal: Map<string, ManifestInfo>,
): WorkspacePackage[] {
  const result: WorkspacePackage[] = []
  const visited = new Set<string>([pkg.name])
  const queue = getDependencyNames(pkg)

  while (queue.length > 0) {
    const name = queue.shift()!
    if (visited.has(name))
      continue
    visited.add(name)

    const info = internal.get(name)
    if (!info)
      continue

    result.push({ name, directory: info.directory })
    queue.push(...info.dependencies)
  }

  return result
}

/**
 * Maps manifest paths to the `include` paths of the project entries that
 * matched them. An entry may be a pattern, so it is resolved on its own.
 */
async function resolveIncludes(
  cwd: string,
  entries: ProjectEntry[],
  ignore: string[],
): Promise<Map<string, string[]>> {
  const includes = new Map<string, string[]>()

  for (const entry of entries) {
    if (typeof entry === 'string' || entry.include.length === 0)
      continue

    for (const manifest of await findManifests(cwd, [entry.path], ignore)) {
      const current = includes.get(manifest) ?? []
      includes.set(manifest, [...new Set([...current, ...entry.include])])
    }
  }

  return includes
}

export async function resolveProjects(
  config: BumpyConfig,
  cwd: string = process.cwd(),
): Promise<Project[]> {
  const packageManagerPatterns = await getPackageManagerPatterns(cwd)
  const projectEntries = config.projects ?? []
  const patterns
    = projectEntries.length > 0
      ? projectEntries.map(e => (typeof e === 'string' ? e : e.path))
      : packageManagerPatterns

  const entries = await findManifests(cwd, patterns, config.release.ignore)
  const includes = await resolveIncludes(
    cwd,
    projectEntries,
    config.release.ignore,
  )

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

  const manifests: Array<{ pkgPath: string, pkg: any, include: string[] }> = []
  for (const entry of entries) {
    const pkgPath = path.join(cwd, entry)
    const pkg = await readManifest(pkgPath)
    if (pkg?.name)
      manifests.push({ pkgPath, pkg, include: includes.get(entry) ?? [] })
  }

  const internal = config.release.includeWorkspaceDeps
    ? await resolveInternalPackages(
        cwd,
        [...new Set([...packageManagerPatterns, ...patterns])],
        new Set(manifests.map(m => m.pkg.name)),
      )
    : new Map<string, ManifestInfo>()

  return manifests.map(({ pkgPath, pkg, include }) => ({
    name: pkg.name,
    directory: path.relative(cwd, path.dirname(pkgPath)) || '.',
    version: pkg.version || '0.0.0',
    packageJsonPath: pkgPath,
    repoUrl: getRepoUrl(pkg) || rootRepoUrl,
    workspaceDeps: collectWorkspaceDeps(pkg, internal),
    include,
  }))
}

export function getProjectPaths(project: Project): string[] {
  return [
    project.directory,
    ...project.workspaceDeps.map(d => d.directory),
    ...project.include,
  ]
}
