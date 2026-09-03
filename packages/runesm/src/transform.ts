/**
 * Where a source string submitted to a session is about to run, so a
 * transform can vary its behavior per entry point.
 */
export type SourceTransformContext =
  /** The module handed to `runJudge`. */
  | { readonly kind: 'judge' }
  /** One `evaluate` input; the persistent scope sees the transformed text. */
  | { readonly kind: 'repl' }
  /** One module of a test workspace, keyed by its canonical id. */
  | { readonly kind: 'test'; readonly id: string }

/**
 * Rewrites submitted source on the main thread before it is posted to the
 * coordinator worker. The usual job is compiling a superset of JavaScript
 * (TypeScript, JSX) down to the plain ESM the runner executes. The worker
 * only ever sees the returned text, so a transform cannot weaken the
 * runner's isolation; it can only change what gets isolated.
 *
 * A thrown error or rejected promise does not reject the session call. It
 * surfaces as an error result whose `error` carries the thrown name and
 * message, plus `line` and `column` when the error exposes them.
 */
export type SourceTransform = (source: string, context: SourceTransformContext) => string | Promise<string>
