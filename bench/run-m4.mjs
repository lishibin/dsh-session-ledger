import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = await mkdtemp(join(tmpdir(), 'dsh-session-ledger-m4-'))
const index = join(root, 'reference-index.json')
const buildResult = join(root, 'build.json')
const incrementalResult = join(root, 'incremental.json')
const output = resolve('bench/results/m4-latest.json')

function run(result, extra = []) {
  execFileSync(process.execPath, [
    'bench/run-baseline.mjs',
    `--index=${index}`,
    `--result=${result}`,
    ...extra,
  ], { stdio: 'inherit' })
}

try {
  run(buildResult)
  run(incrementalResult, ['--append=bench/fixtures/events-append.jsonl'])
  const build = JSON.parse(await readFile(buildResult, 'utf8'))
  const incremental = JSON.parse(await readFile(incrementalResult, 'utf8'))
  const result = {
    generatedAt: new Date().toISOString(),
    fixture: build.fixture,
    build: build.build,
    restart: build.restart,
    incremental: incremental.incremental,
    searchesBeforeAppend: build.searches,
    searchesAfterAppend: incremental.searches,
    note: 'Reference token-index baseline only; validate the same fixture through ctx.sessionQuery for provider measurements.',
  }
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(result, null, 2))
} finally {
  await rm(root, { recursive: true, force: true })
}
