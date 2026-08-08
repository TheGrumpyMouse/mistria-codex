/// <reference types="vite/client" />

/** Stamped in by vite.config.ts from the package version. */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  /**
   * The sync Worker's origin, e.g. `https://mistria-sync.you.workers.dev`.
   *
   * Build-time and deliberately not a setting: a URL someone can type in is a
   * URL an attacker can talk someone into typing in, and this app's whole
   * privacy claim is that nothing leaves the device unless you ask. Unset in a
   * build with no Worker deployed, and the settings panel says so rather than
   * offering a button that cannot work.
   */
  readonly VITE_SYNC_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
