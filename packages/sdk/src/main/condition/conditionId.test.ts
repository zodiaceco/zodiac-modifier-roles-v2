import { expect, it, suite } from "vitest"
import { Operator, ParameterType } from "../types"

import { conditionAddress, conditionId } from "./conditionId"
import { normalizeCondition } from "./normalize"

suite("conditionAddress", () => {
  it("calculates the create2 storage address of the condition", () => {
    const normalizedCondition = normalizeCondition({
      operator: Operator.Matches,
      paramType: ParameterType.Calldata,
      children: [
        {
          operator: Operator.Matches,
          paramType: ParameterType.Tuple,
          children: [
            {
              operator: Operator.EqualToAvatar,
              paramType: ParameterType.Static,
            },
            {
              operator: Operator.EqualTo,
              paramType: ParameterType.Dynamic,
              compValue:
                "0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000016617262697472756d666f756e646174696f6e2e65746800000000000000000000",
            },
            { operator: Operator.Pass, paramType: ParameterType.Static },
            { operator: Operator.Pass, paramType: ParameterType.Static },
            {
              operator: Operator.Pass,
              paramType: ParameterType.Array,
              children: [
                { operator: Operator.Pass, paramType: ParameterType.Static },
              ],
            },
            { operator: Operator.Pass, paramType: ParameterType.Dynamic },
            {
              operator: Operator.EqualTo,
              paramType: ParameterType.Dynamic,
              compValue:
                "0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000008736e617073686f74000000000000000000000000000000000000000000000000",
            },
          ],
        },
        {
          operator: Operator.Matches,
          paramType: ParameterType.Tuple,
          children: [
            {
              operator: Operator.EqualTo,
              paramType: ParameterType.Dynamic,
              compValue:
                "0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000008736e617073686f74000000000000000000000000000000000000000000000000",
            },
          ],
        },
      ],
    })
    expect(conditionAddress(normalizedCondition)).to.equal(
      "0xa835a51f2a581493b7416daed729cc78e0f68224" // see: https://arbiscan.io/address/0xa835a51f2a581493b7416daed729cc78e0f68224#code
    )
  })
})

suite("conditionId", () => {
  it("ignores field order, extra fields, missing children and hex case", () => {
    const a = {
      compValue: "0xABCD",
      operator: Operator.EqualTo,
      paramType: ParameterType.Static,
      extra: true,
    } as any
    const b = {
      paramType: ParameterType.Static,
      operator: Operator.EqualTo,
      compValue: "0xabcd",
      children: [],
    } as any
    expect(conditionId(a)).toBe(conditionId(b))
  })

  it("treats a missing compValue like an empty one", () => {
    expect(
      conditionId({ paramType: ParameterType.Static, operator: Operator.Pass })
    ).toBe(
      conditionId({
        paramType: ParameterType.Static,
        operator: Operator.Pass,
        compValue: "0x",
      })
    )
  })

  it("tells apart trees whose packed bytes are the same", () => {
    // the second child's packed header (0x0020) is folded into the first
    // child's compValue
    const twoChildren = {
      paramType: ParameterType.Tuple,
      operator: Operator.Matches,
      children: [
        {
          paramType: ParameterType.Static,
          operator: Operator.EqualTo,
          compValue: "0x11",
        },
        { paramType: ParameterType.Static, operator: Operator.Pass },
      ],
    } as const
    const oneChild = {
      paramType: ParameterType.Tuple,
      operator: Operator.Matches,
      children: [
        {
          paramType: ParameterType.Static,
          operator: Operator.EqualTo,
          compValue: "0x110020",
        },
      ],
    } as const
    expect(conditionId(twoChildren)).not.toBe(conditionId(oneChild))
  })
})
