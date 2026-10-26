import { ParamType } from "ethers"
import { Condition, Operator, ParameterType } from "../../../types"

import { mapScoping } from "./matches"
import { isFixedArray } from "./helpers/parameterType"

import { ArrayElement, ConditionFunction, Scoping } from "../types"

/**
 * Passes if every element of the array matches the given condition.
 * @param elementScoping The condition on the array elements
 */
export const every =
  <S extends Scoping<ArrayElement<T>>, T extends any[]>(
    elementScoping: S
  ): ConditionFunction<T> =>
  (abiType: ParamType) => {
    if (abiType.baseType !== "array") {
      throw new Error("every() can only be used on array types")
    }
    if (isFixedArray(abiType)) {
      // the contract iterates over a length-prefixed array
      throw new Error(
        "every() can only be used on dynamic arrays (T[]); use matches() on fixed-size arrays"
      )
    }
    if (elementScoping === undefined) {
      throw new Error("every() element condition must not be undefined")
    }
    return {
      paramType: ParameterType.Array,
      operator: Operator.ArrayEvery,
      children: [
        mapScoping(elementScoping, abiType.arrayChildren!) as Condition, // cast is safe because of earlier elementScoping check
      ],
    }
  }
