// Asserts the gzip size of the unminified ESM build outputs stays within
// the runner's budget. Unminified+gzip is a conservative upper bound for
// the published minified size; acorn stays external (excluded by design).
import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const buildDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
const budgetBytes = 50 * 1024

const outputs = readdirSync(buildDir).filter((file) => file.endsWith('.mjs'))
if (outputs.length === 0) {
  console.error('check-size: no .mjs outputs found — run the build first')
  process.exit(1)
}

let totalBytes = 0
for (const file of outputs) {
  const gzipped = gzipSync(readFileSync(join(buildDir, file))).length
  totalBytes += gzipped
  console.log(`  ${file}: ${(gzipped / 1024).toFixed(2)} KB gzipped`)
}

console.log(`check-size: ${(totalBytes / 1024).toFixed(2)} KB total (budget ${budgetBytes / 1024} KB)`)

if (totalBytes >= budgetBytes) {
  console.error('check-size: runner core exceeds the size budget')
  process.exit(1)
}
