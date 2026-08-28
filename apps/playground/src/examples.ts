import type { JudgeCase } from 'runesm'

export const DEFAULT_CODE = `import isEven from 'is-even'

// Bare imports resolve from esm.sh. Pin a version in the deps
// list below, or let autoInstall pick the latest.
export const solve = (n) => (isEven(n) ? 'even' : 'odd')

console.log('module loaded')
`

export const DEMO_CASES: readonly JudgeCase[] = [
  { name: 'two is even', exportName: 'solve', args: [2], expected: 'even' },
  { name: 'seven is odd', exportName: 'solve', args: [7], expected: 'odd' },
  { name: 'mistaken expectation', exportName: 'solve', args: [10], expected: 'odd' },
]
