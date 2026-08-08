/**
 * The sync client.
 *
 * This package exists so the app and the Worker share one definition of a
 * device code. Two implementations of a checksum is two implementations that
 * eventually disagree, and the failure mode is somebody's valid code being
 * rejected — or worse, an invalid one accepted.
 */
export * from './code.js'
