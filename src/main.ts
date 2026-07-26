import {
  createIPN,
  runSSHSession,
  type IPN,
  type IPNNetMap,
  type IPNNetMapPeerNode,
  type IPNState,
} from "@tailscale/connect"
import wasmURL from "@tailscale/connect/main.wasm?url"
import "@tailscale/connect/pkg.css"
import "./style.css"
import {
  clearPersistentIPNState,
  hasPersistentIPNState,
  PersistentIPNStateStorage,
} from "./storage"
import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from "./browser-storage"

const REMEMBER_PREFERENCE_KEY = "natsukage-restore-ephemeral"
const HOSTNAME_KEY = "natsukage-hostname"
const COLOR_SCHEME_KEY = "natsukage-color-scheme"

const COLOR_SCHEMES = [
  ["mocha", "Mocha"],
  ["macchiato", "Macchiato"],
  ["frappe", "Frappé"],
  ["latte", "Latte"],
] as const

type ColorScheme = (typeof COLOR_SCHEMES)[number][0]

function isColorScheme(value: string | null): value is ColorScheme {
  return COLOR_SCHEMES.some(([id]) => id === value)
}

function savedColorScheme(): ColorScheme {
  const value = readLocalStorage(COLOR_SCHEME_KEY)
  return isColorScheme(value) ? value : "mocha"
}

function colorSchemeOptions(): string {
  return COLOR_SCHEMES.map(
    ([id, label]) => `<option value="${id}">${label}</option>`,
  ).join("")
}

function cssColor(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
}

const INITIAL_COLOR_SCHEME = savedColorScheme()
document.documentElement.dataset.colorScheme = INITIAL_COLOR_SCHEME

const STATE_LABELS: Record<IPNState, string> = {
  NoState: "idle",
  InUseOtherUser: "in use",
  NeedsLogin: "login required",
  NeedsMachineAuth: "approval required",
  Stopped: "offline",
  Starting: "connecting",
  Running: "tailnet up",
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Required element not found: ${selector}`)
  }
  return element
}

function shortName(name: string): string {
  return name.split(".")[0] || name
}

function randomHostname(): string {
  return `natsukage-${crypto.randomUUID().slice(0, 8)}`
}

function escapeHTML(value: string): string {
  const element = document.createElement("span")
  element.textContent = value
  return element.innerHTML
}

document.querySelector("#app")!.innerHTML = `
  <div class="app-shell">
    <main class="app-main">
      <section id="preflight-shell" class="preflight-shell">
        <div class="preflight-card">
          <div class="preflight-header">
            <span>TAILNET ACCESS</span>
            <div class="preflight-controls">
              <select class="scheme-select" data-color-scheme-picker
                      aria-label="Color scheme">
                ${colorSchemeOptions()}
              </select>
              <div id="tailnet-status" class="status-pill" data-state="idle">
                <span class="status-dot"></span>
                <span id="tailnet-status-label">idle</span>
              </div>
            </div>
          </div>

          <section id="welcome-panel" class="welcome-panel">
            <button id="start-button" class="primary-button" type="button">
              Connect to Tailscale
            </button>

            <label class="restore-option">
              <input id="remember-session" type="checkbox">
              <span class="checkbox-visual" aria-hidden="true"></span>
              <span>Remember session</span>
            </label>

            <div id="saved-state-note" class="saved-state-note" hidden>
              Saved session
              <button id="clear-saved-before-start" type="button" class="text-button">
                Clear
              </button>
            </div>
          </section>

          <section id="connecting-panel" class="connecting-panel" hidden>
            <div class="loader" aria-hidden="true"></div>
            <div>
              <p id="connecting-title" class="connecting-title">Starting Tailscale</p>
              <p id="connecting-detail" class="connecting-detail">
                Loading network…
              </p>
              <a id="auth-link" class="secondary-button" href="#" target="_blank"
                 rel="noopener noreferrer" hidden>
                Open Tailscale login ↗
              </a>
            </div>
          </section>

          <section id="error-panel" class="error-panel" hidden>
            <span class="error-icon" aria-hidden="true">!</span>
            <div>
              <h2>Connection failed</h2>
              <p id="error-message"></p>
              <button id="retry-button" class="secondary-button" type="button">
                Reload
              </button>
            </div>
          </section>
        </div>
      </section>

      <section id="workspace" class="workspace" hidden>
        <aside class="machine-sidebar">
          <div class="sidebar-heading">
            <span>hosts</span>
            <div class="sidebar-tools">
              <select class="scheme-select" data-color-scheme-picker
                      aria-label="Color scheme">
                ${colorSchemeOptions()}
              </select>
              <button id="refresh-button" class="icon-button" type="button"
                      title="Refresh hosts" aria-label="Refresh hosts">↻</button>
            </div>
          </div>

          <div id="machine-list" class="machine-list"></div>

          <div class="sidebar-footer">
            <button id="forget-button" class="danger-text-button" type="button">
              Forget session &amp; log out
            </button>
          </div>
        </aside>

        <section class="session-area">
          <div id="session-empty" class="session-empty">
            <code>$ select host</code>
          </div>

          <div id="ssh-form-panel" class="ssh-form-panel" hidden>
            <button id="back-button" class="back-button" type="button">← Back</button>
            <div class="selected-machine">
              <span id="selected-machine-status" class="machine-online-dot"></span>
              <div>
                <span class="section-kicker">SSH TO</span>
                <h2 id="selected-machine-name"></h2>
                <code id="selected-machine-ip"></code>
              </div>
            </div>
            <form id="ssh-form">
              <label for="ssh-username">Username</label>
              <input id="ssh-username" name="username" type="text"
                     placeholder="ubuntu" autocomplete="username"
                     autocapitalize="none" spellcheck="false" required>

              <label for="ssh-auth-method">Authentication</label>
              <select id="ssh-auth-method" name="auth-method">
                <option value="private-key">Private key</option>
                <option value="password">Password</option>
              </select>

              <div id="private-key-fields" class="auth-fields">
                <label for="ssh-private-key">OpenSSH private key</label>
                <input id="ssh-private-key" name="private-key" type="file">
                <label for="ssh-key-passphrase">Key passphrase (optional)</label>
                <input id="ssh-key-passphrase" name="key-passphrase"
                       type="password" autocomplete="off">
              </div>

              <div id="password-fields" class="auth-fields" hidden>
                <label for="ssh-password">SSH password</label>
                <input id="ssh-password" name="password" type="password"
                       autocomplete="off">
              </div>

              <p id="ssh-error" class="ssh-error" role="alert" hidden></p>
              <button class="primary-button compact" type="submit">Connect</button>
              <p>Credentials stay in this tab and are never saved.</p>
            </form>
          </div>

          <div id="terminal-panel" class="terminal-panel" hidden>
            <div class="terminal-toolbar">
              <span id="terminal-title">SSH</span>
              <span id="terminal-progress"></span>
              <code id="terminal-host-key" hidden></code>
            </div>
            <div id="terminal" class="terminal-container"></div>
          </div>
        </section>
      </section>
    </main>
  </div>
`

class NatsukageApp {
  readonly #rememberCheckbox =
    requiredElement<HTMLInputElement>("#remember-session")
  readonly #startButton =
    requiredElement<HTMLButtonElement>("#start-button")
  readonly #welcomePanel =
    requiredElement<HTMLElement>("#welcome-panel")
  readonly #connectingPanel =
    requiredElement<HTMLElement>("#connecting-panel")
  readonly #connectingTitle =
    requiredElement<HTMLElement>("#connecting-title")
  readonly #connectingDetail =
    requiredElement<HTMLElement>("#connecting-detail")
  readonly #authLink = requiredElement<HTMLAnchorElement>("#auth-link")
  readonly #preflightShell =
    requiredElement<HTMLElement>("#preflight-shell")
  readonly #workspace = requiredElement<HTMLElement>("#workspace")
  readonly #machineList = requiredElement<HTMLElement>("#machine-list")
  readonly #refreshButton =
    requiredElement<HTMLButtonElement>("#refresh-button")
  readonly #sessionEmpty = requiredElement<HTMLElement>("#session-empty")
  readonly #sshFormPanel = requiredElement<HTMLElement>("#ssh-form-panel")
  readonly #sshForm = requiredElement<HTMLFormElement>("#ssh-form")
  readonly #usernameInput =
    requiredElement<HTMLInputElement>("#ssh-username")
  readonly #authMethod =
    requiredElement<HTMLSelectElement>("#ssh-auth-method")
  readonly #privateKeyFields =
    requiredElement<HTMLElement>("#private-key-fields")
  readonly #privateKeyInput =
    requiredElement<HTMLInputElement>("#ssh-private-key")
  readonly #privateKeyPassphrase =
    requiredElement<HTMLInputElement>("#ssh-key-passphrase")
  readonly #passwordFields =
    requiredElement<HTMLElement>("#password-fields")
  readonly #passwordInput =
    requiredElement<HTMLInputElement>("#ssh-password")
  readonly #sshError = requiredElement<HTMLElement>("#ssh-error")
  readonly #terminalPanel = requiredElement<HTMLElement>("#terminal-panel")
  readonly #terminal = requiredElement<HTMLDivElement>("#terminal")
  readonly #terminalTitle = requiredElement<HTMLElement>("#terminal-title")
  readonly #terminalProgress =
    requiredElement<HTMLElement>("#terminal-progress")
  readonly #terminalHostKey =
    requiredElement<HTMLElement>("#terminal-host-key")
  readonly #errorPanel = requiredElement<HTMLElement>("#error-panel")
  readonly #errorMessage = requiredElement<HTMLElement>("#error-message")
  readonly #status = requiredElement<HTMLElement>("#tailnet-status")
  readonly #statusLabel =
    requiredElement<HTMLElement>("#tailnet-status-label")
  readonly #savedStateNote =
    requiredElement<HTMLElement>("#saved-state-note")
  readonly #colorSchemePickers = Array.from(
    document.querySelectorAll<HTMLSelectElement>("[data-color-scheme-picker]"),
  )

  #ipn?: IPN
  #storage?: PersistentIPNStateStorage
  #netMap?: IPNNetMap
  #selectedPeer?: IPNNetMapPeerNode
  #ipnState: IPNState = "NoState"
  #authWindow: Window | null = null
  #loginRequested = false
  #remember = false
  #terminalActive = false
  #sshFailure?: string

  async initialize(): Promise<void> {
    this.setColorScheme(INITIAL_COLOR_SCHEME, false)
    for (const picker of this.#colorSchemePickers) {
      picker.addEventListener("change", () => {
        this.setColorScheme(picker.value)
      })
    }

    this.#rememberCheckbox.checked =
      readLocalStorage(REMEMBER_PREFERENCE_KEY) === "true"

    try {
      this.#savedStateNote.hidden = !(await hasPersistentIPNState())
    } catch (error) {
      console.warn("Could not inspect saved Tailscale state", error)
    }

    this.#startButton.addEventListener("click", () => void this.start())
    requiredElement("#clear-saved-before-start").addEventListener(
      "click",
      () => void this.clearSavedState(),
    )
    requiredElement("#forget-button").addEventListener(
      "click",
      () => void this.forgetAndLogout(),
    )
    this.#refreshButton.addEventListener("click", () => {
      this.refreshMachines()
    })
    requiredElement("#back-button").addEventListener("click", () => {
      this.showMachinePicker()
    })
    requiredElement("#retry-button").addEventListener("click", () => {
      location.reload()
    })
    this.#sshForm.addEventListener("submit", (event) => {
      event.preventDefault()
      void this.startSSH()
    })
    this.#authMethod.addEventListener("change", () => {
      this.updateAuthenticationFields()
    })
    this.updateAuthenticationFields()
  }

  async start(): Promise<void> {
    this.#remember = this.#rememberCheckbox.checked
    if (
      !writeLocalStorage(REMEMBER_PREFERENCE_KEY, String(this.#remember))
    ) {
      this.#remember = false
      this.#rememberCheckbox.checked = false
    }
    this.#startButton.disabled = true
    this.showOnly(this.#connectingPanel)

    // Opening synchronously from the click keeps the eventual Tailscale login
    // from being blocked as a popup after the WASM client asks for a URL.
    this.#authWindow = window.open(
      "",
      `natsukage-tailscale-login-${crypto.randomUUID()}`,
      "popup,width=720,height=760",
    )
    if (this.#authWindow) {
      this.#authWindow.document.title = "Natsukage — Tailscale login"
      this.#authWindow.document.body.innerHTML =
        "<p style='font:16px system-ui;padding:32px;color:#202124'>" +
        "Checking saved session…</p>"
    }

    try {
      if (this.#remember) {
        this.#connectingDetail.textContent =
          "Checking the ephemeral session saved in this browser…"
        this.#storage = await PersistentIPNStateStorage.open()
        await navigator.storage?.persist?.().catch(() => false)
      }

      const hostname =
        this.#remember
          ? readLocalStorage(HOSTNAME_KEY) || randomHostname()
          : randomHostname()
      if (this.#remember) {
        writeLocalStorage(HOSTNAME_KEY, hostname)
      }

      this.#connectingDetail.textContent =
        "Starting the Tailscale network in this browser…"
      this.#ipn = await createIPN({
        hostname,
        stateStorage: this.#storage,
        wasmURL,
        panicHandler: (error) => this.showError(error),
      })

      this.#ipn.run({
        notifyState: (state) => this.handleState(state),
        notifyNetMap: (value) => this.handleNetMap(value),
        notifyBrowseToURL: (url) => this.handleBrowseToURL(url),
        notifyPanicRecover: (error) => this.showError(error),
      })
    } catch (error) {
      this.showError(error)
    }
  }

  handleState(state: IPNState): void {
    this.#ipnState = state
    this.#statusLabel.textContent = STATE_LABELS[state]
    this.#status.dataset.state =
      state === "Running"
        ? "online"
        : state === "NeedsLogin" || state === "Starting"
          ? "pending"
          : "idle"

    if (state === "NeedsLogin") {
      this.#connectingTitle.textContent = "Log in to Tailscale"
      this.#connectingDetail.textContent =
        this.#remember && this.#storage
          ? "The saved node has expired. Creating a new ephemeral node."
          : "This browser will join your Tailnet as an ephemeral node."
      if (!this.#loginRequested) {
        this.#loginRequested = true
        this.#ipn?.login()
      }
      return
    }

    if (state === "NeedsMachineAuth") {
      this.#connectingTitle.textContent = "Waiting for device approval"
      this.#connectingDetail.textContent =
        "An administrator must approve this browser node before it can connect."
      return
    }

    if (state === "Starting") {
      this.#connectingTitle.textContent = "Connecting to Tailnet"
      this.#connectingDetail.textContent =
        "Connecting to the control server and DERP relay…"
      return
    }

    if (state === "Running") {
      this.#loginRequested = false
      this.#authWindow?.close()
      this.#authWindow = null
      this.#authLink.hidden = true
      void this.#storage?.settled()
      if (this.#netMap) {
        this.showOnly(this.#workspace)
        this.renderMachines()
      }
      return
    }

    if (state === "InUseOtherUser") {
      this.showError(
        "The saved state belongs to another Tailscale user. Clear it and try again.",
      )
    }
  }

  handleNetMap(value: string): void {
    this.#refreshButton.disabled = false
    this.#refreshButton.removeAttribute("aria-busy")
    try {
      this.#netMap = JSON.parse(value) as IPNNetMap
    } catch {
      this.showError("Could not read the host list returned by Tailscale.")
      return
    }

    if (this.#netMap.lockedOut) {
      this.showError(
        `Tailnet Lock requires this browser node to be signed. ` +
          `Run “tailscale lock sign ${this.#netMap.self.nodeKey}” on a trusted device.`,
      )
      return
    }

    if (this.#ipnState === "Running") {
      this.showOnly(this.#workspace)
      this.renderMachines()
    }
  }

  handleBrowseToURL(url: string): void {
    // Authentication URLs are only used while this browser joins the Tailnet.
    if (this.#ipnState === "Running") {
      return
    }

    this.#authLink.href = url
    this.#authLink.hidden = false
    this.#connectingDetail.textContent =
      "Complete the Tailscale login in the other window."
    if (this.#authWindow && !this.#authWindow.closed) {
      this.#authWindow.location.replace(url)
    }
  }

  refreshMachines(): void {
    if (!this.#ipn || this.#ipnState !== "Running") {
      return
    }
    this.#refreshButton.disabled = true
    this.#refreshButton.setAttribute("aria-busy", "true")
    this.#ipn.refreshNetMap()
    window.setTimeout(() => {
      this.#refreshButton.disabled = false
      this.#refreshButton.removeAttribute("aria-busy")
    }, 2_000)
  }

  renderMachines(): void {
    if (!this.#netMap) {
      return
    }
    const peers = this.#netMap.peers
      .filter((peer) => peer.online !== false)
      .sort((left, right) => left.name.localeCompare(right.name))

    if (peers.length === 0) {
      this.#machineList.innerHTML = `
        <div class="empty-machines">
          <strong>No online hosts</strong>
          <p>Make sure Tailscale and sshd are running on the target.</p>
        </div>
      `
      return
    }

    this.#machineList.innerHTML = peers
      .map((peer) => {
        const name = escapeHTML(shortName(peer.name))
        const address = escapeHTML(peer.addresses[0] ?? "No Tailnet IP")
        const selected = peer.nodeKey === this.#selectedPeer?.nodeKey
        return `
          <button class="machine-button${selected ? " selected" : ""}"
                  type="button" data-node-key="${escapeHTML(peer.nodeKey)}">
            <span class="machine-copy">
              <strong>${name}</strong>
              <small>${address}</small>
            </span>
            <span class="machine-online-dot" title="Online"></span>
          </button>
        `
      })
      .join("")

    for (const button of this.#machineList.querySelectorAll<HTMLButtonElement>(
      ".machine-button",
    )) {
      button.addEventListener("click", () => {
        const peer = peers.find(
          (candidate) => candidate.nodeKey === button.dataset.nodeKey,
        )
        if (peer) {
          this.selectPeer(peer)
        }
      })
    }
  }

  selectPeer(peer: IPNNetMapPeerNode): void {
    this.#selectedPeer = peer
    this.#sshFailure = undefined
    this.#sshError.textContent = ""
    this.#sshError.hidden = true
    this.renderMachines()
    this.#sessionEmpty.hidden = true
    this.#terminalPanel.hidden = true
    this.#sshFormPanel.hidden = false
    requiredElement("#selected-machine-name").textContent = shortName(peer.name)
    requiredElement("#selected-machine-ip").textContent =
      peer.addresses[0] ?? peer.name
    this.#usernameInput.focus()
  }

  showMachinePicker(): void {
    if (this.#terminalActive) {
      return
    }
    this.#selectedPeer = undefined
    this.#sshFormPanel.hidden = true
    this.#terminalPanel.hidden = true
    this.#sessionEmpty.hidden = false
    this.renderMachines()
  }

  updateAuthenticationFields(): void {
    const usePrivateKey = this.#authMethod.value === "private-key"
    this.#privateKeyFields.hidden = !usePrivateKey
    this.#passwordFields.hidden = usePrivateKey
    this.#privateKeyInput.required = usePrivateKey
    this.#passwordInput.required = !usePrivateKey
  }

  setColorScheme(value: string, persist = true): void {
    if (!isColorScheme(value)) {
      return
    }
    document.documentElement.dataset.colorScheme = value
    for (const picker of this.#colorSchemePickers) {
      picker.value = value
    }
    if (persist) {
      writeLocalStorage(COLOR_SCHEME_KEY, value)
    }
  }

  setColorSchemeEnabled(enabled: boolean): void {
    for (const picker of this.#colorSchemePickers) {
      picker.disabled = !enabled
    }
  }

  async startSSH(): Promise<void> {
    if (!this.#ipn || !this.#selectedPeer || this.#terminalActive) {
      return
    }
    const username = this.#usernameInput.value.trim()
    if (!username) {
      this.#usernameInput.focus()
      return
    }

    let password: string | undefined
    let privateKey: string | undefined
    let privateKeyPassphrase: string | undefined
    if (this.#authMethod.value === "private-key") {
      const file = this.#privateKeyInput.files?.[0]
      if (!file) {
        this.#privateKeyInput.focus()
        return
      }
      try {
        privateKey = await file.text()
      } catch (error) {
        this.showError(
          error instanceof Error
            ? `Could not read the private key: ${error.message}`
            : "Could not read the private key.",
        )
        return
      }
      privateKeyPassphrase = this.#privateKeyPassphrase.value || undefined
    } else {
      password = this.#passwordInput.value
      if (!password) {
        this.#passwordInput.focus()
        return
      }
    }

    this.#terminalActive = true
    this.setColorSchemeEnabled(false)
    this.#sshFormPanel.hidden = true
    this.#sessionEmpty.hidden = true
    this.#terminalPanel.hidden = false
    this.#terminal.replaceChildren()
    this.#terminalTitle.textContent =
      `${username}@${shortName(this.#selectedPeer.name)}`
    this.#terminalProgress.textContent = "connecting…"
    this.#terminalHostKey.textContent = ""
    this.#terminalHostKey.hidden = true
    this.#sshFailure = undefined
    this.#sshError.textContent = ""
    this.#sshError.hidden = true

    runSSHSession(
      this.#terminal,
      {
        hostname: this.#selectedPeer.name,
        username,
        password,
        privateKey,
        privateKeyPassphrase,
        timeoutSeconds: 15,
      },
      this.#ipn,
      {
        onConnectionProgress: (message) => {
          this.#terminalProgress.textContent = message
          if (message.startsWith("SSH host key ")) {
            this.#terminalHostKey.textContent = message
            this.#terminalHostKey.hidden = false
          }
        },
        onConnected: () => {
          this.#terminalProgress.textContent = "connected"
        },
        onError: (error) => {
          const detail = error.trim() || "SSH connection failed."
          this.#sshFailure = detail
          this.#sshError.textContent = detail
          this.#sshError.hidden = false
          this.#terminalProgress.textContent = "error"
          console.error("SSH error", error)
        },
        onDone: () => {
          this.#terminalActive = false
          this.setColorSchemeEnabled(true)
          if (this.#sshFailure) {
            this.#terminalPanel.hidden = true
            this.#sshFormPanel.hidden = false
            const retryInput =
              this.#authMethod.value === "private-key"
                ? this.#privateKeyInput
                : this.#passwordInput
            retryInput.focus()
            return
          }
          this.#terminalProgress.textContent = "closed"
          window.setTimeout(() => this.showMachinePicker(), 600)
        },
      },
      {
        fontFamily:
          '"HackGen Console NF", "HackGen Console", HackGen, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, monospace',
        fontSize: 13,
        lineHeight: 1.2,
        letterSpacing: 0,
        scrollback: 10_000,
        theme: {
          background: cssColor("--ctp-base"),
          foreground: cssColor("--ctp-text"),
          cursor: cssColor("--ctp-rosewater"),
          cursorAccent: cssColor("--ctp-base"),
          selectionBackground: cssColor("--ctp-surface2"),
          black: cssColor("--ctp-surface1"),
          red: cssColor("--ctp-red"),
          green: cssColor("--ctp-green"),
          yellow: cssColor("--ctp-yellow"),
          blue: cssColor("--ctp-blue"),
          magenta: cssColor("--ctp-mauve"),
          cyan: cssColor("--ctp-teal"),
          white: cssColor("--ctp-subtext1"),
          brightBlack: cssColor("--ctp-overlay0"),
          brightRed: cssColor("--ctp-maroon"),
          brightGreen: cssColor("--ctp-green"),
          brightYellow: cssColor("--ctp-peach"),
          brightBlue: cssColor("--ctp-sapphire"),
          brightMagenta: cssColor("--ctp-pink"),
          brightCyan: cssColor("--ctp-sky"),
          brightWhite: cssColor("--ctp-text"),
        },
      },
    )

    this.#passwordInput.value = ""
    this.#privateKeyPassphrase.value = ""
    this.#privateKeyInput.value = ""
  }

  async clearSavedState(): Promise<void> {
    try {
      await clearPersistentIPNState()
      removeLocalStorage(HOSTNAME_KEY)
      removeLocalStorage(REMEMBER_PREFERENCE_KEY)
      this.#rememberCheckbox.checked = false
      this.#savedStateNote.hidden = true
    } catch (error) {
      this.showError(error)
    }
  }

  async forgetAndLogout(): Promise<void> {
    if (
      !window.confirm(
        "Clear the saved Tailscale state and log out?",
      )
    ) {
      return
    }

    try {
      this.#ipn?.logout()
      await new Promise((resolve) => window.setTimeout(resolve, 800))
      await this.#storage?.settled()
      this.#storage?.close()
      this.#storage = undefined
      await clearPersistentIPNState()
      removeLocalStorage(HOSTNAME_KEY)
      removeLocalStorage(REMEMBER_PREFERENCE_KEY)
      location.reload()
    } catch (error) {
      this.showError(error)
    }
  }

  showError(error: unknown): void {
    this.#authWindow?.close()
    this.#authWindow = null
    this.#errorMessage.textContent =
      error instanceof Error ? error.message : String(error)
    this.showOnly(this.#errorPanel)
    this.#status.dataset.state = "error"
    this.#statusLabel.textContent = "error"
  }

  showOnly(panel: HTMLElement): void {
    const showWorkspace = panel === this.#workspace
    this.#preflightShell.hidden = showWorkspace
    this.#workspace.hidden = !showWorkspace

    for (const candidate of [
      this.#welcomePanel,
      this.#connectingPanel,
      this.#errorPanel,
    ]) {
      candidate.hidden = candidate !== panel
    }
  }
}

void new NatsukageApp().initialize()
