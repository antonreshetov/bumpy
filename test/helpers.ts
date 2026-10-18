import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'

export async function createWorkspace(
  files: Record<string, unknown>,
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bumpy-'))
  await writeFiles(dir, files)
  return dir
}

export async function writeFiles(
  dir: string,
  files: Record<string, unknown>,
): Promise<void> {
  for (const [file, content] of Object.entries(files)) {
    const filePath = path.join(dir, file)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(
      filePath,
      typeof content === 'string' ? content : JSON.stringify(content, null, 2),
    )
  }
}

export async function initGitRepo(dir: string): Promise<void> {
  // Isolate from the user's global hooks and signing settings
  await git(dir, 'init', '-q', '-b', 'main')
  await git(dir, 'config', 'user.name', 'Test')
  await git(dir, 'config', 'user.email', 'test@example.com')
  await git(dir, 'config', 'commit.gpgsign', 'false')
  await git(dir, 'config', 'tag.gpgsign', 'false')
  await git(dir, 'config', 'core.hooksPath', '/dev/null')
}

export async function commitAll(dir: string, message: string): Promise<void> {
  await git(dir, 'add', '-A')
  await git(dir, 'commit', '-q', '-m', message)
}

export async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await execa('git', args, { cwd: dir })
  return stdout
}
