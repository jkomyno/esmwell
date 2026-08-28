import { analyzeScope } from 'src/scope-analysis'
import { parseUserModule } from 'src/parse'

interface Fixture {
  name: string
  code: string
  topLevelDeclarations?: string[]
  importedNames?: string[]
  freeReferences?: string[]
  boundReferences?: string[]
}

type ExpectationFields = 'topLevelDeclarations' | 'importedNames' | 'freeReferences' | 'boundReferences'

/** Asserts the fixture table; unspecified fields are not checked. */
const fixtures: Fixture[] = [
  {
    name: 'simple declaration and reference',
    code: 'let count = 0\ncount + 1',
    topLevelDeclarations: ['count'],
    freeReferences: [],
    boundReferences: ['count'],
  },
  {
    name: 'free references to globals are reported',
    code: 'console.log(Math.max(1, 2))',
    freeReferences: ['console', 'Math'],
    boundReferences: [],
  },
  {
    name: 'shadowing in nested blocks',
    code: 'let x = 1\n{\n  let x = 2\n  x\n}\nx',
    topLevelDeclarations: ['x'],
    boundReferences: ['x', 'x'],
    freeReferences: [],
  },
  {
    name: 'function params shadow outer bindings',
    code: 'const value = 1\nconst f = (value) => value + 1\nf(value)',
    freeReferences: [],
    boundReferences: ['value', 'f', 'value'],
  },
  {
    name: 'arrow expression body sees params',
    code: 'const double = (n) => n * 2\ndouble(3)',
    boundReferences: ['n', 'double'],
  },
  {
    name: 'closures observe the input binding',
    code: 'let counter = 0\nconst tick = () => counter++\ntick()',
    boundReferences: ['counter', 'tick'],
  },
  {
    name: 'destructuring declares all binding names',
    code: 'const { a, b: renamed, c = fallback } = source\na + renamed + c',
    topLevelDeclarations: ['a', 'renamed', 'c'],
    freeReferences: ['source', 'fallback'],
    boundReferences: ['a', 'renamed', 'c'],
  },
  {
    name: 'array destructuring with holes and rest',
    code: 'const [first, , third, ...rest] = items\nfirst + third + rest.length',
    topLevelDeclarations: ['first', 'third', 'rest'],
    freeReferences: ['items'],
    boundReferences: ['first', 'third', 'rest'],
  },
  {
    name: 'nested destructuring patterns',
    code: 'const { deep: { inner }, list: [one, two] } = data\ninner + one + two',
    freeReferences: ['data'],
  },
  {
    name: 'param destructuring with defaults',
    code: 'function draw({ x = 0, y = offsetY } = {}) {\n  return x + y\n}',
    freeReferences: ['offsetY'],
    boundReferences: ['x', 'y'],
  },
  {
    name: 'catch parameters bind in their clause',
    code: 'try {\n  risky()\n} catch (error) {\n  error.message\n}',
    freeReferences: ['risky'],
    boundReferences: ['error'],
  },
  {
    name: 'for-of bindings cover the body',
    code: 'for (const item of items) {\n  console.log(item)\n}',
    freeReferences: ['items', 'console'],
    boundReferences: ['item'],
  },
  {
    name: 'for-in bindings and shadowing',
    code: 'let key = 0\nfor (const key in obj) {\n  key\n}\nkey',
    freeReferences: ['obj'],
    boundReferences: ['key', 'key'],
  },
  {
    name: 'for-head initializer references resolve in the head scope',
    code: 'for (let i = start; i < end; i++) {\n  total += i\n}',
    freeReferences: ['start', 'end', 'total'],
    boundReferences: ['i', 'i', 'i'],
  },
  {
    name: 'class declarations bind their name',
    code: 'class Widget {\n  build() {\n    return new Widget()\n  }\n}\nnew Widget()',
    boundReferences: ['Widget', 'Widget'],
  },
  {
    name: 'class declaration binds its own name for its body',
    code: 'class A {\n  static self = A\n}',
    topLevelDeclarations: ['A'],
    freeReferences: [],
    boundReferences: ['A'],
  },
  {
    name: 'class expression self-binding',
    code: 'const Tree = class Named {\n  static create() {\n    return new Named()\n  }\n}\nTree.create()',
    boundReferences: ['Named', 'Tree'],
  },
  {
    name: 'class extends evaluates outside the self-binding',
    code: 'const Base = class {}\nconst Sub = class extends Base {}',
    boundReferences: ['Base'],
  },
  {
    name: 'shorthand property values are references',
    code: 'let width = 10\nconst size = { width, height: width * 2 }',
    boundReferences: ['width', 'width'],
  },
  {
    name: 'computed keys are references, plain keys are not',
    code: 'const keyName = "k"\nconst obj = { [keyName]: 1, keyName: 2, plain: 3 }',
    boundReferences: ['keyName'],
  },
  {
    name: 'member accesses are not references',
    code: 'const value = obj.prop\nobj.prop = value',
    freeReferences: ['obj', 'obj'],
    boundReferences: ['value'],
  },
  {
    name: 'computed member accesses are references',
    code: 'const value = table[index]\nobj[method]()',
    freeReferences: ['table', 'index', 'obj', 'method'],
    boundReferences: [],
  },
  {
    name: 'labels are not references',
    code: 'outer: for (const i of list) {\n  continue outer\n}',
    freeReferences: ['list'],
    boundReferences: [],
  },
  {
    name: 'imports bind their local names',
    code: "import { shuffle } from 'lodash-es'\nimport defaultExport from 'pkg-a'\nshuffle([1]) + defaultExport",
    importedNames: ['shuffle', 'defaultExport'],
    boundReferences: ['shuffle', 'defaultExport'],
    freeReferences: [],
  },
  {
    name: 'import renaming keeps imported names foreign',
    code: "import { internal as external } from 'pkg'\nexternal()",
    importedNames: ['external'],
    boundReferences: ['external'],
  },
  {
    name: 'function declarations are visible before their statement',
    code: 'run()\nfunction run() {\n  helper()\n}\nfunction helper() {}',
    boundReferences: ['run', 'helper'],
  },
  {
    name: 'assignment targets are references',
    code: 'let total = 0\ntotal = total + 1',
    boundReferences: ['total', 'total'],
  },
  {
    name: 'destructuring assignment targets are references',
    code: 'let a = 0, b = 0\n({ a, b } = pair)\n[a, b] = [b, a]',
    freeReferences: ['pair'],
    boundReferences: ['a', 'b', 'a', 'b', 'b', 'a'],
  },
  {
    name: 'switch case blocks scope their declarations',
    code: 'switch (mode) {\n  case 1: {\n    let cached = compute()\n    cached\n  }\n  case 2:\n    cached = 1\n}',
    freeReferences: ['mode', 'compute', 'cached'],
    boundReferences: ['cached'],
  },
  {
    name: 'template literals and expressions inside them',
    code: 'const name = "runesm"\n`hello ${name} ${name.length}`',
    boundReferences: ['name', 'name'],
  },
  {
    name: 'optional chaining and nullish handling',
    code: 'const value = settings?.theme ?? "dark"',
    freeReferences: ['settings'],
  },
  {
    name: 'getters and setters in classes reference the scope',
    code: 'let stored = 0\nclass Box {\n  get value() {\n    return stored\n  }\n}',
    boundReferences: ['stored'],
  },
  {
    name: 'async functions and await',
    code: 'async function load() {\n  const response = await fetch(url)\n  return response\n}',
    freeReferences: ['fetch', 'url'],
    boundReferences: ['response'],
  },
  {
    name: 'generator functions',
    code: 'function* counter() {\n  yield 1\n}',
    boundReferences: [],
  },
  {
    name: 'export statements keep references live',
    code: 'const exported = 1\nexport { exported as out }\nexport const derived = exported + 1',
    topLevelDeclarations: ['exported', 'derived'],
    boundReferences: ['exported', 'exported'],
  },
  {
    name: 'new.target and import.meta are not references',
    code: 'function f() {\n  return new.target\n}\nconst meta = import.meta.url',
    freeReferences: [],
    boundReferences: [],
  },
  {
    name: 'adversarial shadowing chain',
    code: 'let a = 1\nfunction outer(a) {\n  const b = () => {\n    let a = 2\n    return a + b\n  }\n  return b\n}\nouter(a)',
    boundReferences: ['a', 'b', 'b', 'outer', 'a'],
  },
  {
    name: 'computed destructuring key is reported as a reference',
    code: 'const { [k]: v } = o\nv + k',
    topLevelDeclarations: ['v'],
    freeReferences: ['o', 'k', 'k'],
    boundReferences: ['v'],
  },
  {
    name: 'cover-initialized name in assignment destructuring is a reference',
    code: 'let a\n({ a = 1 } = obj)',
    freeReferences: ['obj'],
    boundReferences: ['a'],
  },
]

describe('analyzeScope fixtures', () => {
  it.each(fixtures)('$name', (fixture) => {
    const analysis = analyzeScope(parseUserModule(fixture.code))

    const actual: Record<ExpectationFields, string[]> = {
      topLevelDeclarations: [...analysis.topLevelDeclarations],
      importedNames: [...analysis.importedNames],
      freeReferences: analysis.references.filter((reference) => !reference.bound).map((reference) => reference.name),
      boundReferences: analysis.references.filter((reference) => reference.bound).map((reference) => reference.name),
    }
    const expected: Partial<Record<ExpectationFields, string[]>> = {}
    for (const key of Object.keys(actual) as ExpectationFields[]) {
      const value = fixture[key]
      if (value !== undefined) {
        expected[key] = [...value]
      }
    }
    expect(actual).toMatchObject(expected)
  })

  it('reports source positions for rewriting', () => {
    const analysis = analyzeScope(parseUserModule('let start = 1\nstart + 1'))
    const reference = analysis.references[0]
    expect(reference).toMatchObject({ name: 'start', bound: true })
    expect(reference?.start).toBe(14)
    expect(reference?.end).toBe(19)
  })
})
