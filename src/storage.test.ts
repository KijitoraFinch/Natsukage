import "fake-indexeddb/auto"
import { afterEach, describe, expect, it } from "vitest"
import {
  clearPersistentIPNState,
  hasPersistentIPNState,
  PersistentIPNStateStorage,
} from "./storage"

describe("persistent state storage", () => {
  afterEach(async () => {
    await clearPersistentIPNState()
  })

  it("persists and restores IPN state", async () => {
    const first = await PersistentIPNStateStorage.open()
    first.setState("_current-profile", "deadbeef")
    await first.settled()
    first.close()

    expect(await hasPersistentIPNState()).toBe(true)

    const second = await PersistentIPNStateStorage.open()
    expect(second.getState("_current-profile")).toBe("deadbeef")
    second.close()
  })

  it("deletes empty state values", async () => {
    const storage = await PersistentIPNStateStorage.open()
    storage.setState("profile", "cafebabe")
    await storage.settled()
    storage.setState("profile", "")
    await storage.settled()
    expect(storage.getState("profile")).toBe("")
    storage.close()

    expect(await hasPersistentIPNState()).toBe(false)
  })
})
