# WebAssembly packages in esmwell

User modules run in a browser worker with the native `WebAssembly` and `fetch` APIs. They can fetch and instantiate a `.wasm` URL directly, or use a package's browser or Web Worker entrypoint when that package provides one.

Runtime-specific package entrypoints are not interchangeable. In particular, `@cf-wasm/og`'s default export resolves to its `workerd` build, which imports `.wasm` files using Cloudflare Workers module rules that browsers do not implement. Use the package's `others` entries and initialize their WebAssembly binaries explicitly.

## Rendering a PNG with `@cf-wasm/og`

```js
import { CustomFont, ImageResponse } from '@cf-wasm/og/others'
import { t } from '@cf-wasm/og/html-to-react'
import { initResvg } from '@cf-wasm/resvg/legacy/others'
import { initSatori } from '@cf-wasm/satori/others'

await Promise.all([
  initResvg(fetch('https://esm.sh/@cf-wasm/resvg@0.4.0/legacy/resvg.wasm?raw')),
  initSatori(fetch('https://esm.sh/@cf-wasm/satori@0.4.0/yoga.wasm?raw')),
])

export const renderImage = async () => {
  const defaultFont = new CustomFont(
    'sans serif',
    fetch('https://cdn.jsdelivr.net/npm/@cf-wasm/og@0.5.0/dist/lib/noto-sans-v27-latin-regular.ttf.bin').then(
      (response) => response.arrayBuffer(),
    ),
  )
  return ImageResponse.async(t('<div style="display: flex">Hello from WebAssembly</div>'), {
    width: 320,
    height: 180,
    defaultFont,
  })
}
```

Pin all three packages in the session because the submitted module imports each one directly:

```ts
import { createEsmwell } from 'esmwell'

const session = createEsmwell({
  deps: {
    '@cf-wasm/og': '0.5.0',
    '@cf-wasm/resvg': '0.4.0',
    '@cf-wasm/satori': '0.4.0',
  },
  autoInstall: false,
})
```

The browser suite executes this flow through the published worker entry and checks the generated PNG signature. The CDN and asset URLs make that test intentionally network-dependent.
