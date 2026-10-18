import { execa } from 'execa'

export async function isWorkingTreeClean(): Promise<boolean> {
  const { stdout } = await execa('git', ['status', '--porcelain'])
  return stdout.trim() === ''
}

/** `tagPattern` is a `git describe --match` glob, see `tagMatchPattern`. */
export async function getLastTag(tagPattern: string): Promise<string | null> {
  try {
    const { stdout } = await execa('git', [
      'describe',
      '--tags',
      '--abbrev=0',
      '--match',
      tagPattern,
    ])
    return stdout.trim()
  }
  catch {
    return null
  }
}

export async function listTags(tagPattern: string): Promise<string[]> {
  try {
    const { stdout } = await execa('git', ['tag', '--list', tagPattern])
    return stdout.split('\n').filter(Boolean)
  }
  catch {
    return []
  }
}

export async function getCommits(
  range: string,
  paths: string[],
): Promise<string[]> {
  const args = ['log', '--format=%B%n-hash-%n%H%n-separator-', range]
  if (paths.length > 0) {
    args.push('--', ...paths)
  }

  try {
    const { stdout } = await execa('git', args)
    return stdout
      .split('-separator-')
      .map(s => s.trim())
      .filter(Boolean)
  }
  catch {
    return []
  }
}

export async function hasPendingCommits(
  tagPattern: string,
  paths: string[],
): Promise<boolean> {
  const lastTag = await getLastTag(tagPattern)
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD'
  const commits = await getCommits(range, paths)
  return commits.length > 0
}

export async function hasRemote(): Promise<boolean> {
  try {
    const { stdout } = await execa('git', ['remote'])
    return stdout.trim().length > 0
  }
  catch {
    return false
  }
}

export async function getRemoteUrl(): Promise<string | null> {
  try {
    const { stdout } = await execa('git', ['remote', 'get-url', 'origin'])
    return stdout.trim()
  }
  catch {
    try {
      const { stdout: remotes } = await execa('git', ['remote'])
      const firstRemote = remotes.split('\n')[0]?.trim()
      if (firstRemote) {
        const { stdout: url } = await execa('git', [
          'remote',
          'get-url',
          firstRemote,
        ])
        return url.trim()
      }
    }
    catch {}
    return null
  }
}

export async function createTag(
  tagName: string,
  message: string,
  dryRun: boolean,
): Promise<void> {
  if (!dryRun) {
    await execa('git', ['tag', '-a', tagName, '-m', message])
  }
}

export async function commitFiles(
  files: string[],
  message: string,
  dryRun: boolean,
): Promise<void> {
  if (!dryRun) {
    await execa('git', ['add', ...files])
    await execa('git', ['commit', '-m', message])
  }
}

export async function push(dryRun: boolean): Promise<void> {
  if (!dryRun) {
    await execa('git', ['push'])
    await execa('git', ['push', '--tags'])
  }
}
