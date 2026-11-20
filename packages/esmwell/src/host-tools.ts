import type { HostToolReply, HostToolRequest, HostTools, HostToolsConnection } from './host-tools-protocol'

export type { CallHostTool, HostTools } from './host-tools-protocol'

export interface HostToolContext {
  /** Aborted when the owning run settles, times out, or closes. */
  readonly signal: AbortSignal
}

export type HostTool = (args: readonly unknown[], context: HostToolContext) => unknown

export interface HostToolCall {
  /** Run number within this host-tool configuration. */
  readonly runId: number
  readonly id: number
  readonly tool: string
  readonly status: 'success' | 'error' | 'denied' | 'cancelled'
}

export interface HostToolsOptions {
  readonly tools: Readonly<Record<string, HostTool>>
  /** Called once per accepted or denied request, without arguments or results. */
  readonly onCall?: (call: HostToolCall) => void
}

const MAX_PENDING_CALLS = 32

/** Gives execution workers access to a fixed set of named host functions. */
export function createHostTools(options: HostToolsOptions): HostTools {
  const tools = new Map(Object.entries(options.tools))
  const onCall = options.onCall
  let runId = 0
  return { open: () => openConnection(tools, ++runId, onCall) }
}

const openConnection = (
  tools: ReadonlyMap<string, HostTool>,
  runId: number,
  onCall: HostToolsOptions['onCall'],
): HostToolsConnection => {
  const { port1: host, port2: worker } = new MessageChannel()
  const send = host.postMessage.bind(host)
  const controller = new AbortController()
  const pending = new Map<number, string>()
  let lastId = 0

  const record = (id: number, tool: string, status: HostToolCall['status']): void => {
    try {
      onCall?.({ runId, id, tool, status })
    } catch {
      // Observers cannot change a call's outcome or interrupt cleanup.
    }
  }

  const finish = (tool: string, reply: HostToolReply, status: HostToolCall['status']): void => {
    try {
      send(reply)
    } catch {
      send({ id: reply.id, ok: false, message: 'the host tool returned a value that could not be cloned' })
      status = 'error'
    }
    record(reply.id, tool, status)
  }

  host.addEventListener('message', (event: MessageEvent<unknown>): void => {
    const request = event.data
    if (controller.signal.aborted || !isToolRequest(request) || request.id <= lastId) return
    const { id, tool, args } = request
    lastId = id
    const handler = tools.get(tool)
    if (handler === undefined || pending.size >= MAX_PENDING_CALLS) {
      const message =
        handler === undefined ? 'the requested host tool is not registered' : 'too many pending host tool calls'
      finish(tool, { id, ok: false, message }, 'denied')
      return
    }
    pending.set(id, tool)
    void Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted()
        return handler(args, { signal: controller.signal })
      })
      .then(
        (value) => {
          if (pending.delete(id)) finish(tool, { id, ok: true, value }, 'success')
        },
        () => {
          if (pending.delete(id)) finish(tool, { id, ok: false, message: 'the host tool failed' }, 'error')
        },
      )
  })
  host.start()

  return {
    port: worker,
    close(): void {
      if (controller.signal.aborted) return
      host.close()
      worker.close()
      controller.abort()
      for (const [id, tool] of pending) record(id, tool, 'cancelled')
      pending.clear()
    },
  }
}

const isToolRequest = (value: unknown): value is HostToolRequest => {
  if (typeof value !== 'object' || value === null) return false
  const { id, tool, args } = value as Partial<HostToolRequest>
  return Number.isSafeInteger(id) && typeof tool === 'string' && Array.isArray(args)
}
