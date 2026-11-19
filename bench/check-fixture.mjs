import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'

const fixture = 'bench/fixtures/events.jsonl'
const expected = Number(process.env.EXPECTED_EVENTS ?? 100_000)
const info = await stat(fixture).catch(() => null)
if (!info) throw new Error(`fixture not found: ${fixture}; run npm run bench:generate first`)

const reader = createInterface({ input: createReadStream(fixture, 'utf8'), crlfDelay: Infinity })
let count = 0
let first = null
let last = null
for await (const line of reader) {
  if (!line) continue
  const event = JSON.parse(line)
  if (!event.workspace_id || !event.session_id || !Number.isInteger(event.event_seq) || !event.timestamp || !event.text) {
    throw new Error(`invalid event at line ${count + 1}`)
  }
  first ??= event
  last = event
  count += 1
}
if (count !== expected) throw new Error(`expected ${expected} events, found ${count}`)
console.log(JSON.stringify({ fixture, count, bytes: info.size, first, last }, null, 2))
