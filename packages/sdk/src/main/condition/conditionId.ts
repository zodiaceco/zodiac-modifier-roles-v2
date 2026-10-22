import { createHash } from "crypto"
import {
  BytesLike,
  concat,
  getCreate2Address,
  dataLength,
  keccak256,
  toBeHex,
} from "ethers"
import { Condition, Operator, ParameterType } from "../types"

import { abiEncode } from "../abiEncode"

import { flattenCondition, ConditionFlat } from "./flattenCondition"

const ERC2470_SINGLETON_FACTORY_ADDRESS =
  "0xce0042b868300000d44a59004da54a005ffdcf9f"
const ZERO_SALT =
  "0x0000000000000000000000000000000000000000000000000000000000000000"

export function conditionHash(condition: Condition) {
  return (
    "0x" + createHash("sha256").update(conditionId(condition)).digest("hex")
  )
}

/**
 * A canonical string id: two conditions get the same id exactly when they are
 * the same tree. Field order, extra fields, missing `children`/`compValue` and
 * the hex case of `compValue` make no difference.
 */
export function conditionId(condition: Condition): string {
  const canonical = (c: Condition): Condition => ({
    paramType: c.paramType,
    operator: c.operator,
    compValue: (c.compValue || "0x").toLowerCase() as `0x${string}`,
    children: (c.children || []).map(canonical),
  })

  return JSON.stringify(canonical(condition))
}

/**
 * The key normalizeCondition sorts And/Or branches by. It is not an id: the
 * compValues are concatenated without lengths, so different conditions can
 * share a key (break ties with conditionId). It stays as it is because the
 * order it gives decides the normalized tree, and so the condition addresses
 * of roles already applied on chain.
 */
export const conditionSortKey = (condition: Condition): bigint => {
  const conditions = flattenCondition(condition)
  return BigInt(
    concat(
      conditions.flatMap((condition) => [
        packCondition(condition),
        condition.compValue || "0x",
      ])
    )
  )
}

/**
 * Calculates the create2 storage address of the condition.
 */
export const conditionAddress = (condition: Condition) => {
  const conditions = flattenCondition(condition)
  removeExtraneousOffsets(conditions)

  const packed = concat([
    ...conditions.map((condition) => packCondition(condition)),
    ...conditions.map((condition) => packCompValue(condition)),
  ])

  const initCode = initCodeFor(packed)

  return getCreate2Address(
    ERC2470_SINGLETON_FACTORY_ADDRESS,
    ZERO_SALT,
    keccak256(initCode)
  ).toLowerCase()
}

// 8    bits -> parent
// 3    bits -> param type
// 5    bits -> operator
const offsetParent = 8
const offsetParamType = 5
const offsetOperator = 0

const packCondition = (condition: ConditionFlat) => {
  return toBeHex(
    (condition.parent << offsetParent) |
      (condition.paramType << offsetParamType) |
      (condition.operator << offsetOperator),
    condition.parent >= 256 ? undefined : 2
  )
}

const packCompValue = (condition: ConditionFlat) => {
  if (!hasCompValue(condition.operator)) return "0x"
  if (!condition.compValue) {
    throw new Error(
      `compValue is required for operator ${Operator[condition.operator]}`
    )
  }

  return condition.operator === Operator.EqualTo
    ? keccak256(condition.compValue)
    : abiEncode(["bytes32"], [condition.compValue])
}

const removeExtraneousOffsets = (conditions: ConditionFlat[]) => {
  for (let i = 0; i < conditions.length; i++) {
    if (
      conditions[i].compValue &&
      conditions[i].operator == Operator.EqualTo &&
      !isInline(conditions, i)
    ) {
      conditions[i].compValue = "0x" + conditions[i].compValue!.slice(66)
    }
  }
}

const isInline = (conditions: ConditionFlat[], index: number) => {
  const paramType = conditions[index].paramType
  switch (paramType) {
    case ParameterType.Static:
      return true
    case ParameterType.Tuple:
      for (let j = index + 1; j < conditions.length; ++j) {
        const parent = conditions[j].parent
        if (parent < index) continue
        if (parent > index) break
        if (!isInline(conditions, j)) {
          return false
        }
      }
      return true
    default:
      return false
  }
}

const initCodeFor = (bytecode: BytesLike) =>
  concat([
    "0x63",
    toBeHex(dataLength(bytecode) + 1, 4),
    "0x80600E6000396000F3",
    "0x00",
    bytecode,
  ])

const hasCompValue = (operator: Operator) => operator >= Operator.EqualTo
