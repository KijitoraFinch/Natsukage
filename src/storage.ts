import type { IPNStateStorage } from "@tailscale/connect"

const DATABASE_NAME = "natsukage-tailnet"
const DATABASE_VERSION = 1
const STATE_STORE = "ipn-state"
const KEY_STORE = "encryption-key"
const ENCRYPTION_KEY_ID = "state-key"

type EncryptedRecord = {
  id: string
  iv: ArrayBuffer
  ciphertext: ArrayBuffer
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    })
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    })
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true })
    transaction.addEventListener(
      "error",
      () => reject(transaction.error),
      { once: true },
    )
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error),
      { once: true },
    )
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.addEventListener("upgradeneeded", () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STATE_STORE)) {
        database.createObjectStore(STATE_STORE, { keyPath: "id" })
      }
      if (!database.objectStoreNames.contains(KEY_STORE)) {
        database.createObjectStore(KEY_STORE)
      }
    })
    request.addEventListener(
      "success",
      () => {
        request.result.addEventListener("versionchange", () => {
          request.result.close()
        })
        resolve(request.result)
      },
      { once: true },
    )
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    })
  })
}

async function getOrCreateEncryptionKey(
  database: IDBDatabase,
): Promise<CryptoKey> {
  const read = database.transaction(KEY_STORE, "readonly")
  const existing = await requestResult<CryptoKey | undefined>(
    read.objectStore(KEY_STORE).get(ENCRYPTION_KEY_ID),
  )
  await transactionDone(read)
  if (existing) {
    return existing
  }

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
  const write = database.transaction(KEY_STORE, "readwrite")
  write.objectStore(KEY_STORE).put(key, ENCRYPTION_KEY_ID)
  await transactionDone(write)
  return key
}

async function decryptRecord(
  key: CryptoKey,
  record: EncryptedRecord,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: record.iv,
      additionalData: new TextEncoder().encode(record.id),
    },
    key,
    record.ciphertext,
  )
  return new TextDecoder().decode(plaintext)
}

async function encryptValue(
  key: CryptoKey,
  id: string,
  value: string,
): Promise<EncryptedRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(id),
    },
    key,
    new TextEncoder().encode(value),
  )
  return { id, iv: iv.buffer, ciphertext }
}

export class PersistentIPNStateStorage implements IPNStateStorage {
  readonly #database: IDBDatabase
  readonly #key: CryptoKey
  readonly #state: Map<string, string>
  #writes: Promise<void> = Promise.resolve()

  private constructor(
    database: IDBDatabase,
    key: CryptoKey,
    state: Map<string, string>,
  ) {
    this.#database = database
    this.#key = key
    this.#state = state
  }

  static async open(): Promise<PersistentIPNStateStorage> {
    const database = await openDatabase()
    const key = await getOrCreateEncryptionKey(database)
    const transaction = database.transaction(STATE_STORE, "readonly")
    const records = await requestResult<EncryptedRecord[]>(
      transaction.objectStore(STATE_STORE).getAll(),
    )
    await transactionDone(transaction)

    const state = new Map<string, string>()
    for (const record of records) {
      try {
        state.set(record.id, await decryptRecord(key, record))
      } catch {
        // A partially written or stale record must not prevent a fresh login.
      }
    }
    return new PersistentIPNStateStorage(database, key, state)
  }

  getState(id: string): string {
    return this.#state.get(id) ?? ""
  }

  setState(id: string, value: string): void {
    if (value === "") {
      this.#state.delete(id)
    } else {
      this.#state.set(id, value)
    }

    this.#writes = this.#writes
      .then(async () => {
        const encrypted =
          value === "" ? undefined : await encryptValue(this.#key, id, value)
        const transaction = this.#database.transaction(
          STATE_STORE,
          "readwrite",
        )
        const store = transaction.objectStore(STATE_STORE)
        if (value === "") {
          store.delete(id)
        } else {
          store.put(encrypted)
        }
        await transactionDone(transaction)
      })
      .catch((error: unknown) => {
        console.error("Tailscale state could not be persisted", error)
      })
  }

  async settled(): Promise<void> {
    await this.#writes
  }

  close(): void {
    this.#database.close()
  }
}

export async function clearPersistentIPNState(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME)
    request.addEventListener("success", () => resolve(), { once: true })
    request.addEventListener(
      "blocked",
      () =>
        reject(
          new Error(
            "Another tab is using the saved session. Close it and try again.",
          ),
        ),
      { once: true },
    )
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    })
  })
}

export async function hasPersistentIPNState(): Promise<boolean> {
  const database = await openDatabase()
  const transaction = database.transaction(STATE_STORE, "readonly")
  const count = await requestResult(
    transaction.objectStore(STATE_STORE).count(),
  )
  await transactionDone(transaction)
  database.close()
  return count > 0
}
