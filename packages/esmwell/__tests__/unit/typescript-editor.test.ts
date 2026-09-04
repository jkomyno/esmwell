import * as ts from 'typescript-legacy'
import { describe, expect, it, vi } from 'vitest'
import { createTypeScriptModuleScanner, TypeScriptTypeAcquirer } from 'esmwell/typescript-editor'

const scanner = createTypeScriptModuleScanner(ts)

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

const writeText = (target: Uint8Array, offset: number, value: string): void => {
  target.set(new TextEncoder().encode(value), offset)
}

const tar = (files: Readonly<Record<string, string>>): Uint8Array => {
  const encoder = new TextEncoder()
  const entries = Object.entries(files).map(([name, content]) => ({ name, bytes: encoder.encode(content) }))
  const size = entries.reduce((total, entry) => total + 512 + Math.ceil(entry.bytes.length / 512) * 512, 1_024)
  const archive = new Uint8Array(size)
  let offset = 0
  for (const entry of entries) {
    writeText(archive, offset, entry.name)
    writeText(archive, offset + 124, `${entry.bytes.length.toString(8).padStart(11, '0')}\0`)
    archive[offset + 156] = '0'.charCodeAt(0)
    archive.set(entry.bytes, offset + 512)
    offset += 512 + Math.ceil(entry.bytes.length / 512) * 512
  }
  return archive
}

const gzip = async (bytes: Uint8Array): Promise<ArrayBuffer> => {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const stream = new Blob([buffer]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

describe('moduleSpecifiers', () => {
  it('finds real imports and type references without treating examples in comments or strings as imports', () => {
    const source = `
      /// <reference types="node" />
      // import 'comment-example'
      /* import('doc-example') */
      const example = "import('string-example')"
      import type { Schema } from 'effect@beta/Schema'
      const zod = import('zod@4')
    `

    expect(scanner.moduleSpecifiers(source)).toEqual(['effect@beta/Schema', 'zod@4', 'node'])
  })

  it('identifies completion positions inside module specifiers', () => {
    const source = "import { z } from 'zod@4'\nz.object({})"

    expect(scanner.isModuleSpecifierPosition(source, source.indexOf('zod@4') + 3)).toBe(true)
    expect(scanner.isModuleSpecifierPosition(source, source.lastIndexOf('object') + 3)).toBe(false)
  })
})

describe('TypeScriptTypeAcquirer', () => {
  it('loads and caches exact package declaration graphs, including package-internal imports', async () => {
    const effectArchive = await gzip(
      tar({
        'package/dist/dts/Schema.d.ts': `
          import type { LazyArg } from "effect/Function"
          import type { StandardSchemaV1 } from "@standard-schema/spec"
          export declare const Struct: <A>(fields: A) => {
            readonly Type: A
            readonly fields: LazyArg<A>
            readonly standard: StandardSchemaV1<A>
          }
        `,
        'package/dist/dts/Function.d.ts': 'export type LazyArg<A> = () => A',
      }),
    )
    const zodArchive = await gzip(
      tar({
        'package/index.d.ts': 'export declare const z: { string(): string }',
      }),
    )
    const standardSchemaArchive = await gzip(
      tar({
        'package/index.d.ts': 'export interface StandardSchemaV1<A> { readonly output: A }',
      }),
    )
    const responses = new Map<string, () => Response>([
      [
        'https://data.jsdelivr.com/v1/package/resolve/npm/effect@beta',
        () => jsonResponse({ version: '4.0.0-beta.20' }),
      ],
      ['https://data.jsdelivr.com/v1/package/resolve/npm/zod@4', () => jsonResponse({ version: '4.1.5' })],
      [
        'https://data.jsdelivr.com/v1/package/resolve/npm/@standard-schema/spec@%5E1.0.0',
        () => jsonResponse({ version: '1.0.0' }),
      ],
      [
        'https://registry.npmjs.org/effect/4.0.0-beta.20',
        () =>
          jsonResponse({
            name: 'effect',
            version: '4.0.0-beta.20',
            dist: { tarball: 'https://registry.npmjs.org/effect/-/effect-4.0.0-beta.20.tgz' },
            exports: {
              './Function': { types: './dist/dts/Function.d.ts' },
              './Schema': { types: './dist/dts/Schema.d.ts' },
            },
            dependencies: { '@standard-schema/spec': '^1.0.0' },
          }),
      ],
      [
        'https://registry.npmjs.org/zod/4.1.5',
        () =>
          jsonResponse({
            name: 'zod',
            version: '4.1.5',
            types: './index.d.ts',
            dist: { tarball: 'https://registry.npmjs.org/zod/-/zod-4.1.5.tgz' },
          }),
      ],
      [
        'https://registry.npmjs.org/%40standard-schema%2Fspec/1.0.0',
        () =>
          jsonResponse({
            name: '@standard-schema/spec',
            version: '1.0.0',
            types: './index.d.ts',
            dist: { tarball: 'https://registry.npmjs.org/@standard-schema/spec/-/spec-1.0.0.tgz' },
          }),
      ],
      ['https://registry.npmjs.org/effect/-/effect-4.0.0-beta.20.tgz', () => new Response(effectArchive)],
      ['https://registry.npmjs.org/zod/-/zod-4.1.5.tgz', () => new Response(zodArchive)],
      ['https://registry.npmjs.org/@standard-schema/spec/-/spec-1.0.0.tgz', () => new Response(standardSchemaArchive)],
    ])
    const fetchType = vi.fn<(input: string | URL) => Promise<Response>>(async (input): Promise<Response> => {
      const response = responses.get(String(input))
      return response?.() ?? new Response(null, { status: 404 })
    })
    const acquirer = new TypeScriptTypeAcquirer({ scanner, fetch: fetchType })
    const source = `
      import * as Schema from 'effect@beta/Schema'
      import { z } from 'zod@4'
    `

    const graph = await acquirer.acquire(source)
    const cachedGraph = await acquirer.acquire(`// source edit\n${source}`)

    expect(graph.files.map((file) => file.fileName)).toEqual([
      '/node_modules/.esmwell-types/effect@4.0.0-beta.20/dist/dts/Schema.d.ts',
      '/node_modules/.esmwell-types/effect@4.0.0-beta.20/dist/dts/Function.d.ts',
      '/node_modules/.esmwell-types/zod@4.1.5/index.d.ts',
      '/node_modules/.esmwell-types/@standard-schema/spec@1.0.0/index.d.ts',
    ])
    expect(graph.resolutions).toEqual([
      {
        specifier: 'effect@beta/Schema',
        fileName: '/node_modules/.esmwell-types/effect@4.0.0-beta.20/dist/dts/Schema.d.ts',
      },
      {
        specifier: 'effect/Function',
        fileName: '/node_modules/.esmwell-types/effect@4.0.0-beta.20/dist/dts/Function.d.ts',
        containingFilePrefix: '/node_modules/.esmwell-types/effect@4.0.0-beta.20/',
      },
      {
        specifier: 'zod@4',
        fileName: '/node_modules/.esmwell-types/zod@4.1.5/index.d.ts',
      },
      {
        specifier: '@standard-schema/spec',
        fileName: '/node_modules/.esmwell-types/@standard-schema/spec@1.0.0/index.d.ts',
        containingFilePrefix: '/node_modules/.esmwell-types/effect@4.0.0-beta.20/',
      },
    ])
    expect(graph.complete).toBe(true)
    expect(cachedGraph).toBe(graph)
    expect(fetchType).toHaveBeenCalledTimes(9)
  })

  it('retries a package graph after a transient metadata failure', async () => {
    const archive = await gzip(tar({ 'package/index.d.ts': 'export declare const answer: 42' }))
    let resolverAttempts = 0
    const fetchType = vi.fn<(input: string | URL) => Promise<Response>>(async (input): Promise<Response> => {
      switch (String(input)) {
        case 'https://data.jsdelivr.com/v1/package/resolve/npm/example@latest':
          resolverAttempts += 1
          return resolverAttempts === 1 ? new Response(null, { status: 503 }) : jsonResponse({ version: '1.0.0' })
        case 'https://registry.npmjs.org/example/1.0.0':
          return jsonResponse({
            name: 'example',
            version: '1.0.0',
            types: './index.d.ts',
            dist: { tarball: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz' },
          })
        case 'https://registry.npmjs.org/example/-/example-1.0.0.tgz':
          return new Response(archive)
        default:
          return new Response(null, { status: 404 })
      }
    })
    const acquirer = new TypeScriptTypeAcquirer({ scanner, fetch: fetchType })

    expect(await acquirer.acquire("import 'example'")).toMatchObject({ complete: false, files: [] })
    expect(await acquirer.acquire("import 'example'")).toMatchObject({
      complete: true,
      files: [{ fileName: '/node_modules/.esmwell-types/example@1.0.0/index.d.ts' }],
    })
    expect(fetchType).toHaveBeenCalledTimes(4)
  })

  it('aborts a stalled package request at the acquisition deadline', async () => {
    vi.useFakeTimers()
    try {
      let requestSignal: AbortSignal | undefined
      const fetchType = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>(
        async (_input, init) =>
          new Promise((_resolve, reject) => {
            requestSignal = init?.signal ?? undefined
            requestSignal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      )
      const pending = new TypeScriptTypeAcquirer({ scanner, fetch: fetchType, fetchTimeoutMs: 10 }).acquire(
        "import 'stalled'",
      )

      await vi.advanceTimersByTimeAsync(10)

      await expect(pending).resolves.toMatchObject({ complete: false, files: [] })
      expect(requestSignal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
