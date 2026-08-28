// Asserts the built playground references every asset under the configured
// non-root base, so deploying under a sub-path keeps working.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const base = '/playground/'
const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const html = readFileSync(join(distDir, 'index.html'), 'utf8')

const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1])
if (references.length === 0) {
  console.error('check-base: no asset references found in dist/index.html')
  process.exit(1)
}

const offenders = references.filter(
  (reference) =>
    reference.startsWith('/') &&
    !reference.startsWith(base) &&
    !reference.startsWith('//') &&
    !reference.startsWith('/favicon'),
)

if (offenders.length > 0) {
  console.error(`check-base: assets not prefixed with ${base}:`)
  for (const offender of offenders) {
    console.error(`  ${offender}`)
  }
  process.exit(1)
}

console.log(`check-base: all ${references.length} asset references respect ${base}`)
