import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const packageRoot = resolve(import.meta.dirname, '..')
const workspaceRoot = resolve(packageRoot, '../..')
const fixtureRoot = join(packageRoot, '__tests__/fixtures/packed-consumer')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'esmwell-packed-consumer-'))
const consumerRoot = join(temporaryRoot, 'consumer')

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, CI: 'true' },
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status ?? 'unknown'}`)
  }
}

try {
  run('pnpm', ['pack', '--pack-destination', temporaryRoot], packageRoot)

  const tarballs = readdirSync(temporaryRoot).filter((file) => file.endsWith('.tgz'))
  if (tarballs.length !== 1) {
    throw new Error(`expected one package tarball, found ${tarballs.length}`)
  }

  cpSync(fixtureRoot, consumerRoot, { recursive: true })
  const manifestPath = join(consumerRoot, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dependencies.esmwell = `file:${join(temporaryRoot, tarballs[0])}`
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)

  run('pnpm', ['install', '--offline', '--ignore-scripts'], consumerRoot)
  run(join(workspaceRoot, 'node_modules/.bin/vite'), ['build', '.'], consumerRoot)

  console.log('test-pack: packed esmwell installed and built in a clean Vite consumer')
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true })
}
