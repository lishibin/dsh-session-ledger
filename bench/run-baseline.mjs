import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { hostname } from 'node:os'
import { dirname, resolve } from 'node:path'

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=')
  return [key, value ?? true]
}))
const fixture = resolve(String(args.get('fixture') ?? 'bench/fixtures/events.jsonl'))
const appendFixture = args.get('append') ? resolve(String(args.get('append'))) : null
const indexPath = resolve(String(args.get('index') ?? 'bench/fixtures/reference-index.json'))
const resultPath = resolve(String(args.get('result') ?? 'bench/results/latest.json'))
const queryValues = String(args.get('queries') ?? 'deployment,rollback,context,migration,missing-term').split(',')

async function* lines(path) {
  const input = createReadStream(path, { encoding: 'utf8' })
  const reader = createInterface({ input, crlfDelay: Infinity })
  for await (const line of reader) if (line) yield JSON.parse(line)
}

function tokenize(text) {
  return [...new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])]
}

function elapsed(start) {
  return Number(process.hrtime.bigint() - start) / 1e6
}

async function buildIndex(inputPath, outputPath) {
  const started = process.hrtime.bigint()
  const terms = new Map()
  let events = 0
  let bytes = 0
  for await (const event of lines(inputPath)) {
    events += 1
    bytes += Buffer.byteLength(JSON.stringify(event)) + 1
    const ref = {
      workspace_id: event.workspace_id,
      session_id: event.session_id,
      event_seq: event.event_seq,
      timestamp: event.timestamp,
      snippet: event.text,
    }
    for (const term of tokenize(event.text)) {
      const bucket = terms.get(term) ?? []
      bucket.push(ref)
      terms.set(term, bucket)
    }
  }
  const serializable = Object.fromEntries([...terms].map(([term, refs]) => [term, refs]))
  const payload = { schema_version: 1, events, bytes, terms: serializable }
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, JSON.stringify(payload), 'utf8')
  return { mode: 'build', eventsScanned: events, indexDocuments: events, elapsedMs: elapsed(started), bytes }
}

async function loadIndex(path) {
  const started = process.hrtime.bigint()
  const payload = JSON.parse(await readFile(path, 'utf8'))
  return { payload, metrics: { mode: 'restart', eventsScanned: 0, indexDocuments: payload.events, elapsedMs: elapsed(started) } }
}

function search(payload, query) {
  const started = process.hrtime.bigint()
  const refs = payload.terms[query.toLowerCase()] ?? []
  const bySession = new Map()
  for (const ref of refs) if (!bySession.has(ref.session_id)) bySession.set(ref.session_id, ref)
  return { query, matches: bySession.size, elapsedMs: elapsed(started) }
}

async function appendToIndex(path, payload, appendPath) {
  const started = process.hrtime.bigint()
  let scanned = 0
  for await (const event of lines(appendPath)) {
    scanned += 1
    payload.events += 1
    const ref = {
      workspace_id: event.workspace_id,
      session_id: event.session_id,
      event_seq: event.event_seq,
      timestamp: event.timestamp,
      snippet: event.text,
    }
    for (const term of tokenize(event.text)) {
      const bucket = payload.terms[term] ?? []
      bucket.push(ref)
      payload.terms[term] = bucket
    }
  }
  await writeFile(path, JSON.stringify(payload), 'utf8')
  return { mode: 'incremental', eventsScanned: scanned, indexDocuments: scanned, elapsedMs: elapsed(started) }
}

const fixtureStat = await stat(fixture).catch(() => null)
if (!fixtureStat) throw new Error(`fixture not found: ${fixture}; run npm run bench:generate first`)
const build = await stat(indexPath).catch(() => null)
const buildMetrics = build ? null : await buildIndex(fixture, indexPath)
const { payload, metrics: restartMetrics } = await loadIndex(indexPath)
const incrementalMetrics = appendFixture ? await appendToIndex(indexPath, payload, appendFixture) : null
const searches = []
for (const query of queryValues) {
  const samples = []
  for (let i = 0; i < 20; i += 1) samples.push(search(payload, query))
  const times = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b)
  searches.push({ query, matches: samples[0].matches, p50Ms: times[9], p95Ms: times[18], p99Ms: times[19] })
}

const fixtureHash = createHash('sha256').update(await readFile(fixture)).digest('hex')
const result = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  host: hostname(),
  fixture: { path: fixture, bytes: fixtureStat.size, sha256: fixtureHash },
  build: buildMetrics,
  restart: restartMetrics,
  incremental: incrementalMetrics,
  searches,
  note: 'Reference token-index baseline only; validate the same fixture through ctx.sessionQuery for provider measurements.',
}
await mkdir(dirname(resultPath), { recursive: true })
await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(result, null, 2))
