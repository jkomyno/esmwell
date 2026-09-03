/** Installs a runtime-owned global binding that submitted code cannot replace or delete. */
export const defineEsmwellGlobal = (name: string, value: unknown, enumerable: boolean = false): void => {
  const target = globalThis as typeof globalThis & Record<string, unknown>
  const current = Object.getOwnPropertyDescriptor(target, name)

  if (current?.configurable === false) {
    if ('value' in current && current.value === value && current.writable === true) {
      Object.defineProperty(target, name, { writable: false })
      return
    }
    if ('value' in current && current.value === value) {
      return
    }
    throw new Error(`could not protect runtime global '${name}' because it is already non-configurable`)
  }

  Object.defineProperty(target, name, {
    configurable: false,
    enumerable,
    writable: false,
    value,
  })
}
