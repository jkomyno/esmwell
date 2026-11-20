import type { CallHostTool, HostToolReply, HostToolRequest } from './host-tools-protocol'

let active: CallHostTool | undefined
let installed = false

const callActiveTool: CallHostTool = (tool, ...args) =>
  active?.(tool, ...args) ?? Promise.reject(toolError('host tools are available only during an active run'))

export async function runWithHostTools<Result>(port: MessagePort, run: () => Promise<Result>): Promise<Result> {
  if (!installed) {
    Object.defineProperty(globalThis, 'esmwellHostCall', {
      value: callActiveTool,
      writable: false,
      configurable: false,
      enumerable: false,
    })
    installed = true
  }

  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  const post = port.postMessage.bind(port)
  const close = port.close.bind(port)
  let nextId = 0

  port.addEventListener('message', (event: MessageEvent<HostToolReply>): void => {
    const reply = event.data
    const call = pending.get(reply.id)
    if (call === undefined) return
    pending.delete(reply.id)
    if (reply.ok) call.resolve(reply.value)
    else call.reject(toolError(reply.message))
  })
  port.start()

  const call: CallHostTool = (tool, ...args) =>
    new Promise((resolve, reject) => {
      if (typeof tool !== 'string') {
        reject(toolError('the host tool name must be a string'))
        return
      }
      const id = ++nextId
      pending.set(id, { resolve, reject })
      try {
        post({ id, tool, args } satisfies HostToolRequest)
      } catch {
        pending.delete(id)
        reject(toolError('the host tool arguments could not be cloned'))
      }
    })

  active = call
  try {
    return await run()
  } finally {
    if (active === call) active = undefined
    close()
    for (const request of pending.values()) request.reject(toolError('the run ended before the host tool replied'))
    pending.clear()
  }
}

const toolError = (message: string): Error => {
  const error = new Error(message)
  error.name = 'HostToolError'
  return error
}
