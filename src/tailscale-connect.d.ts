declare module "@tailscale/connect" {
  export interface IPNStateStorage {
    setState(id: string, value: string): void
    getState(id: string): string
  }

  export type IPNState =
    | "NoState"
    | "InUseOtherUser"
    | "NeedsLogin"
    | "NeedsMachineAuth"
    | "Stopped"
    | "Starting"
    | "Running"

  export interface IPNNetMapNode {
    name: string
    addresses: string[]
    machineKey: string
    nodeKey: string
  }

  export interface IPNNetMapSelfNode extends IPNNetMapNode {
    machineStatus:
      | "MachineUnknown"
      | "MachineUnauthorized"
      | "MachineAuthorized"
      | "MachineInvalid"
  }

  export interface IPNNetMapPeerNode extends IPNNetMapNode {
    online?: boolean
    tailscaleSSHEnabled: boolean
  }

  export interface IPNNetMap {
    self: IPNNetMapSelfNode
    peers: IPNNetMapPeerNode[]
    lockedOut: boolean
  }

  export interface IPNCallbacks {
    notifyState(state: IPNState): void
    notifyNetMap(netMap: string): void
    notifyBrowseToURL(url: string): void
    notifyPanicRecover(error: string): void
  }

  export interface IPNSSHSession {
    resize(rows: number, cols: number): boolean
    close(): boolean
  }

  export interface IPN {
    run(callbacks: IPNCallbacks): void
    login(): void
    logout(): void
    refreshNetMap(): void
    ssh(
      host: string,
      username: string,
      config: {
        writeFn(data: string): void
        writeErrorFn(error: string): void
        setReadFn(readFn: (data: string) => void): void
        rows: number
        cols: number
        password?: string
        privateKey?: string
        privateKeyPassphrase?: string
        timeoutSeconds?: number
        onConnectionProgress(message: string): void
        onConnected(): void
        onDone(): void
      },
    ): IPNSSHSession
  }

  export interface IPNPackageConfig {
    authKey?: string
    stateStorage?: IPNStateStorage
    controlURL?: string
    hostname?: string
    wasmURL?: string
    panicHandler(error: string): void
  }

  export interface SSHSessionDef {
    username: string
    hostname: string
    password?: string
    privateKey?: string
    privateKeyPassphrase?: string
    timeoutSeconds?: number
  }

  export interface SSHSessionCallbacks {
    onConnectionProgress(message: string): void
    onConnected(): void
    onDone(): void
    onError?(error: string): void
  }

  export function createIPN(config: IPNPackageConfig): Promise<IPN>

  export function runSSHSession(
    terminalContainer: HTMLDivElement,
    definition: SSHSessionDef,
    ipn: IPN,
    callbacks: SSHSessionCallbacks,
    terminalOptions?: Record<string, unknown>,
  ): void
}

declare module "@tailscale/connect/pkg.css"
