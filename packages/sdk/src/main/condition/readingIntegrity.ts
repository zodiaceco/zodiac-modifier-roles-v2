import { sha256, toUtf8Bytes } from "ethers"
import { Condition, Operator, ParameterType } from "../types"

import { conditionHash } from "./conditionId"
import { normalizeCondition } from "./normalize"

export const READING_INTEGRITY_DOCS =
  "https://docs.roles.gnosisguild.org/general/nested-calldata"

export interface ReadingIntegrityOptions {
  /**
   * Acknowledgements of conditions that have been checked and are known to be
   * safe (see READING_INTEGRITY_DOCS), as `ReadingIntegrityError` reports
   * them in `acknowledgement`. These pass the check.
   */
  acknowledged?: readonly string[]
}

/**
 * The function a condition is set on. An acknowledgement made for it covers
 * that condition on that function of that contract only, as the contract
 * receiving the nested call may differ elsewhere.
 */
export interface ReadingIntegrityScope {
  targetAddress: string
  selector: string
}

/**
 * Thrown by `checkReadingIntegrity`. `conditionHash` identifies the function
 * condition (normalized). `acknowledgement` is what to pass in `acknowledged`
 * once it has been checked.
 */
export class ReadingIntegrityError extends Error {
  readonly conditionHash: string
  readonly acknowledgement: string

  constructor(reason: string, hash: string, acknowledgement: string) {
    super(
      `${reason} Whether this is safe depends on the contract receiving the call: see ${READING_INTEGRITY_DOCS}. ` +
        `Once checked, acknowledge this condition with \`acknowledged: ["${acknowledgement}"]\`.`
    )
    this.name = "ReadingIntegrityError"
    this.conditionHash = hash
    this.acknowledgement = acknowledgement
  }
}

/**
 * Rejects conditions that Roles v2 may read differently from the contract
 * receiving the call:
 *
 * - Conditions on calldata nested in a `bytes` parameter (`calldataMatches` or
 *   `abiEncodedMatches` below the top level).
 * - A `bitmask` on a `bytes` value that expects the last bytes it checks to
 *   be zero.
 *
 * Conditions acknowledged in `options.acknowledged` pass. With a `scope`, an
 * acknowledgement covers the condition on that function only; without one,
 * on any function.
 *
 * @param condition The root condition of a function.
 */
export const checkReadingIntegrity = (
  condition: Condition,
  options: ReadingIntegrityOptions & { scope?: ReadingIntegrityScope } = {}
): void => {
  const reason = findReadingHazard(condition, true)
  if (!reason) return

  // Normalized, so the hash is the same before and after processing
  const hash = conditionHash(normalizeCondition(condition))
  const acknowledgement = acknowledgementOf(hash, options.scope)
  if (options.acknowledged?.includes(acknowledgement)) return

  throw new ReadingIntegrityError(reason, hash, acknowledgement)
}

const acknowledgementOf = (hash: string, scope?: ReadingIntegrityScope) =>
  scope
    ? sha256(
        toUtf8Bytes(
          `${scope.targetAddress.toLowerCase()}:${scope.selector.toLowerCase()}:${hash}`
        )
      )
    : hash

const findReadingHazard = (
  condition: Condition,
  topLevel: boolean
): string | undefined => {
  const nested =
    condition.paramType === ParameterType.Calldata ||
    condition.paramType === ParameterType.AbiEncoded
  if (nested && !topLevel) {
    return "The condition checks calldata nested in a `bytes` parameter."
  }

  if (
    condition.operator === Operator.Bitmask &&
    condition.paramType === ParameterType.Dynamic &&
    expectsTrailingZeroBytes(condition.compValue)
  ) {
    return "The condition has a `bitmask` on a `bytes` value that expects the last bytes it checks to be zero."
  }

  // Logical nodes evaluate their children on the same value
  const childrenTopLevel =
    topLevel && condition.paramType === ParameterType.None
  for (const child of condition.children || []) {
    const reason = findReadingHazard(child, childrenTopLevel)
    if (reason) return reason
  }
  return undefined
}

/**
 * Bitmask compValue: 2-byte shift, 15-byte mask, 15-byte expected value.
 *
 * Roles v2 reads bytes past the end of a `bytes` value as zero, so a checked
 * byte expected to be zero may lie past the end. A byte that must be non-zero
 * cannot, nor can any byte before it. The first byte is not affected: an
 * empty value fails the check.
 *
 * True if a checked byte after the first and after the last non-zero one
 * expects zero.
 */
const expectsTrailingZeroBytes = (compValue: `0x${string}` | undefined) => {
  if (!compValue) return false
  const hex = compValue.slice(2).padEnd(64, "0")
  const byteAt = (offset: number, i: number) =>
    parseInt(hex.slice(offset + i * 2, offset + i * 2 + 2), 16)

  let hazard = false
  for (let i = 0; i < 15; i++) {
    const mask = byteAt(4, i)
    const expected = byteAt(34, i) & mask
    if (expected !== 0) {
      hazard = false
    } else if (mask !== 0 && i > 0) {
      hazard = true
    }
  }
  return hazard
}
