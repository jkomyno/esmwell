import { createRunesm } from '/runesm/index.mjs'

test('@cf-wasm/og renders a PNG through browser-initialized WebAssembly dependencies', async () => {
  const session = createRunesm({
    workerUrl: '/runesm/worker-entry.mjs',
    deps: {
      '@cf-wasm/og': '0.5.0',
      '@cf-wasm/resvg': '0.4.0',
      '@cf-wasm/satori': '0.4.0',
    },
    autoInstall: false,
    timeoutMs: 60_000,
  })
  try {
    const result = await session.runJudge(
      `import { CustomFont, ImageResponse } from '@cf-wasm/og/others'
       import { t } from '@cf-wasm/og/html-to-react'
       import { initResvg } from '@cf-wasm/resvg/legacy/others'
       import { initSatori } from '@cf-wasm/satori/others'

       await Promise.all([
         initResvg(fetch('https://esm.sh/@cf-wasm/resvg@0.4.0/legacy/resvg.wasm?raw')),
         initSatori(fetch('https://esm.sh/@cf-wasm/satori@0.4.0/yoga.wasm?raw')),
       ])

       export const renderPng = async () => {
         const response = await ImageResponse.async(
           t('<div style="display: flex">Hello from WebAssembly</div>'),
           {
             width: 320,
             height: 180,
             defaultFont: new CustomFont(
               'sans serif',
               fetch('https://cdn.jsdelivr.net/npm/@cf-wasm/og@0.5.0/dist/lib/noto-sans-v27-latin-regular.ttf.bin')
                 .then((response) => response.arrayBuffer()),
             ),
           },
         )
         const bytes = new Uint8Array(await response.arrayBuffer())
         return {
           contentType: response.headers.get('content-type'),
           pngSignature: Array.from(bytes.slice(0, 8)),
           hasBody: bytes.byteLength > 100,
         }
       }`,
      [
        {
          name: 'renders PNG',
          exportName: 'renderPng',
          expected: {
            contentType: 'image/png',
            pngSignature: [137, 80, 78, 71, 13, 10, 26, 10],
            hasBody: true,
          },
        },
      ],
    )

    assert(result.ok === true, `@cf-wasm/og should render a PNG: ${JSON.stringify(result)}`)
  } finally {
    session.close()
  }
})
