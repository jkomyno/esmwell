import { canonicalModuleId, createProjectModules } from 'src/utils'

it.each([
  ['/src/main.ts', 'src/main'],
  ['///src/main.mts', 'src/main'],
  ['src/component.tsx', 'src/component'],
  ['src/plain', 'src/plain'],
  ['src/data.json', 'src/data.json'],
])('converts editor path %s to %s', (path, id) => {
  expect(canonicalModuleId(path)).toBe(id)
})

it.each([
  '/',
  '/.ts',
  './main.ts',
  '/src/../main.ts',
  '/src//main.ts',
  'src\\main.ts',
  'main.ts?raw',
  '__esmwell_internal__/main.ts',
])('rejects invalid editor path %s', (path) => {
  expect(() => canonicalModuleId(path)).toThrow(/virtual module id/)
})

it('registers script aliases, preserves source and accepts prototype-like ids', () => {
  const modules = createProjectModules([
    ['/src/main.ts', 'export const main = import.meta.main'],
    ['/src/module.mts', 'export const value = 1'],
    ['/src/common.cts', 'export const value = 2'],
    ['/src/view.jsx', 'export const value = 3'],
    ['__proto__.ts', 'export const value = 4'],
    ['plain', 'export const value = 5'],
  ])
  expect({ ...modules }).toEqual({
    'src/main': 'export const main = import.meta.main',
    'src/main.js': 'export const main = import.meta.main',
    'src/module': 'export const value = 1',
    'src/module.mjs': 'export const value = 1',
    'src/common': 'export const value = 2',
    'src/common.cjs': 'export const value = 2',
    'src/view': 'export const value = 3',
    'src/view.js': 'export const value = 3',
    ['__proto__']: 'export const value = 4',
    '__proto__.js': 'export const value = 4',
    plain: 'export const value = 5',
  })
})

it.each([
  ['/src/main.ts', 'src/main.js', /Conflicting module paths/],
  ['/src/main.ts', '/src/main.ts', /Conflicting module paths/],
  ['/src/main.ts', '/src/main.js.ts', /Conflicting module alias/],
  ['/src/main.js.ts', '/src/main.ts', /Conflicting module alias/],
] as const)('rejects colliding paths %s and %s', (first, second, error) => {
  expect(() =>
    createProjectModules([
      [first, ''],
      [second, ''],
    ]),
  ).toThrow(error)
})
