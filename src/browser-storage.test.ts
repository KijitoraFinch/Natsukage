import { afterEach, describe, expect, it, vi } from "vitest"
import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from "./browser-storage"

describe("browser storage access", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("falls back when browser policy disables localStorage", () => {
    const securityError = new DOMException("Access denied", "SecurityError")
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw securityError
      },
      setItem: () => {
        throw securityError
      },
      removeItem: () => {
        throw securityError
      },
    })

    expect(readLocalStorage("preference")).toBeNull()
    expect(writeLocalStorage("preference", "true")).toBe(false)
    expect(() => removeLocalStorage("preference")).not.toThrow()
  })
})
