import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const dsh = process.env.DSH_BIN ?? 'dsh'
const profile = process.env.DSH_PROFILE ?? 'demo'
const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

function run(args) {
  const result = spawnSync(dsh, args, { encoding: 'utf8', stdio: 'inherit' })
  if (result.error?.code === 'ENOENT') {
    console.error(`Host smoke test requires '${dsh}' in PATH; set DSH_BIN to the Harness executable.`)
    process.exit(2)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (!existsSync(resolve(packageRoot, 'cordis.patch.yml'))) {
  throw new Error(`package root is missing cordis.patch.yml: ${packageRoot}`)
}

console.log(`Using Harness profile '${profile}' and package '${packageRoot}'.`)
run(['--version'])
run(['plugin', '--profile', profile, 'add', packageRoot])
run(['--profile', profile, '--dump-config'])
console.log('Host smoke test passed: plugin installation and profile config succeeded.')
