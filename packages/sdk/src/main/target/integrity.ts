import { Clearance, Function, Target } from "../types"

import { checkRootConditionIntegrity } from "../condition/conditionIntegrity"
import { ReadingIntegrityOptions } from "../condition/readingIntegrity"

/**
 * Checks that targets are well-formed and their conditions valid.
 *
 * @param options.acknowledged acknowledgements of conditions checked to be
 * safe despite a `ReadingIntegrityError` (see `checkReadingIntegrity`). Each
 * covers one condition on one function of one target.
 */
export const targetIntegrity = (
  targets: Target[],
  options?: ReadingIntegrityOptions
): void => {
  const uniqueAddresses = new Set(
    targets.map((target) => target.address.toLowerCase())
  )
  if (uniqueAddresses.size < targets.length) {
    throw new Error("Duplicate target addresses")
  }

  targets.forEach((target) => targetEntry(target, options))
}

const targetEntry = (
  target: Target,
  options?: ReadingIntegrityOptions
): void => {
  if (
    target.clearance === Clearance.Function &&
    target.functions.length === 0
  ) {
    throw new Error(
      `Function-cleared targets must have at least one function (target in violation: ${target.address})`
    )
  }

  if (target.clearance !== Clearance.Function && target.functions.length > 0) {
    throw new Error(
      `A target with functions must be function-cleared (target in violation: ${target.address})`
    )
  }

  const uniqueFunctionSelectors = new Set(
    target.functions.map((func) => func.selector.toLowerCase())
  )
  if (uniqueFunctionSelectors.size < target.functions.length) {
    throw new Error(`Duplicate functions in target ${target.address}`)
  }

  target.functions.forEach((func) => functionEntry(target, func, options))
}

const functionEntry = (
  target: Target,
  func: Function,
  options?: ReadingIntegrityOptions
): void => {
  if (func.wildcarded && func.condition) {
    throw new Error(
      `Wildcarded functions cannot have conditions (function in violation: ${func.selector})`
    )
  }

  if (!func.wildcarded && !func.condition) {
    throw new Error(
      `Non-wildcarded functions must have conditions (function in violation: ${func.selector})`
    )
  }

  if (func.condition) {
    checkRootConditionIntegrity(func.condition, {
      ...options,
      scope: { targetAddress: target.address, selector: func.selector },
    })
  }
}
