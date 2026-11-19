import { createWriteStream } from 'node:fs'
import { mkdir, rename, stat } from 'node:fs/promises'
import { once } from 'node:events'
import { dirname, resolve } from 'node:path'

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=')
  return [key, value ?? true]
}))

const events = Number(args.get('events') ?? 100_000)
const sessions = Number(args.get('sessions') ?? 1_000)
const workspaces = Number(args.get('workspaces') ?? 10)
const output = resolve(String(args.get('out') ?? 'bench/fixtures/events.jsonl'))

if (!Number.isInteger(events) || events <= 0) throw new Error('--events must be a positive integer')
if (!Number.isInteger(sessions) || sessions <= 0) throw new Error('--sessions must be a positive integer')
if (!Number.isInteger(workspaces) || workspaces <= 0) throw new Error('--workspaces must be a positive integer')
if (sessions < workspaces) throw new Error('--sessions must be >= --workspaces')

await mkdir(dirname(output), { recursive: true })
const temporary = `${output}.tmp-${process.pid}`
const stream = createWriteStream(temporary, { encoding: 'utf8' })
const terms = [
  'deployment', 'rollback', 'database', 'migration', 'authentication',
  'observability', 'timeout', 'memory', 'context', 'release', 'ticket',
]
const eventTypes = ['user/message', 'assistant/message', 'tool/call', 'tool/result']
const start = Date.UTC(2026, 0, 1)

function write(line) {
  if (!stream.write(`${JSON.stringify(line)}\n`)) return once(stream, 'drain')
}

for (let i = 0; i < events; i += 1) {
  const sessionNumber = i % sessions
  const workspaceNumber = sessionNumber % workspaces
  const term = terms[(i * 17 + sessionNumber) % terms.length]
  const eventType = eventTypes[i % eventTypes.length]
  const sessionId = `session-${String(sessionNumber).padStart(5, '0')}`
  const workspaceId = `workspace-${String(workspaceNumber).padStart(2, '0')}`
  const line = {
    workspace_id: workspaceId,
    session_id: sessionId,
    event_seq: Math.floor(i / sessions) + 1,
    event_type: eventType,
    timestamp: new Date(start + i * 1_000).toISOString(),
    text: `Synthetic ${eventType} for ${term}; workspace ${workspaceNumber}; session ${sessionNumber}; event ${i}.`,
  }
  const pending = write(line)
  if (pending) await pending
}

await new Promise((resolvePromise, reject) => {
  stream.once('error', reject)
  stream.end(resolvePromise)
})
await rename(temporary, output)
const bytes = (await stat(output)).size
console.log(JSON.stringify({ output, events, sessions, workspaces, bytes }, null, 2))
