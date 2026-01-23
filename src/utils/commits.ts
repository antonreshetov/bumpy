import { CommitParser } from 'conventional-commits-parser'

const parser = new CommitParser()

export interface ParsedCommit {
  type: string | null
  scope: string | null
  subject: string | null
  header: string | null
  body: string | null
  footer: string | null
  notes: Array<{
    title: string
    text: string
  }>
  hash: string | null
  raw: string
}

export function parseCommits(rawCommits: string[]): ParsedCommit[] {
  return rawCommits.map((raw) => {
    // The raw commit format from git/index.ts is:
    // Message Body
    // -hash-
    // Hash
    const parts = raw.split('\n-hash-\n')
    const message = parts[0] || ''
    const hash = parts[1]?.trim() || null

    const parsed = parser.parse(message)

    return {
      type: parsed.type || null,
      scope: parsed.scope || null,
      subject: parsed.subject || null,
      header: parsed.header || null,
      body: parsed.body || null,
      footer: parsed.footer || null,
      notes: parsed.notes || [],
      hash,
      raw: message,
    }
  })
}
