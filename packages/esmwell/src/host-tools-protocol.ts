export interface HostToolRequest {
  readonly id: number
  readonly tool: string
  readonly args: readonly unknown[]
}

export type HostToolReply =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly message: string }

/** Calls an explicitly registered host tool from code in an execution worker. */
export type CallHostTool = (tool: string, ...args: readonly unknown[]) => Promise<unknown>

export interface HostToolsConnection {
  readonly port: MessagePort
  close(): void
}

/** An opt-in tool configuration created with `createHostTools`. */
export interface HostTools {
  /** Opens one channel that the runner closes when the run settles. */
  readonly open: () => HostToolsConnection
}
