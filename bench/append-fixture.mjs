import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=')
  return [key, value ?? true]
}))
const count = Number(args.get('events') ?? 1_000)
const output = resolve(String(args.get('out') ?? 'bench/fixtures/events-append.jsonl'))
if (!Number.isInteger(count) || count <= 0) throw new Error('--events must be a positive integer')

await mkdir(dirname(output), { recursive: true })
const lines = []
for (let i = 0; i < count; i += 1) {
  const eventNumber = 100_000 + i
  const sessionNumber = i % 1_000
  lines.push(JSON.stringify({
    workspace_id: `workspace-${String(sessionNumber % 10).padStart(2, '0')}`,
    session_id: `session-${String(sessionNumber).padStart(5, '0')}`,
    event_seq: 101 + Math.floor(i / 1_000),
    event_type: 'user/message',
    timestamp: new Date(Date.UTC(2026, 1, 1) + i * 1_000).toISOString(),
    text: `Synthetic incremental event for reconcile; deployment append ${eventNumber}.`,
  }))
}
await writeFile(output, `${lines.join('\n')}\n`, 'utf8')
console.log(JSON.stringify({ output, events: count }, null, 2))
