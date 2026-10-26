import { describe, expect, it } from "vitest"
import { ParamType } from "ethers"
import { ParameterType, Operator } from "../../../types"

import { calldataMatches, matches } from "./matches"
import { eq } from "./comparison"
import { every } from "./array"
import { describeStructure } from "./helpers/describeStructure"

// The ABI encodes T[k] like the tuple (T, ..., T): inline when T is static,
// with no length word. Conditions must describe it as a Tuple.
describe("fixed-size arrays", () => {
  const pass = (paramType: ParameterType) => ({
    paramType,
    operator: Operator.Pass,
  })

  it("describes T[k] as a tuple of k elements", () => {
    expect(describeStructure(ParamType.from("uint256[2]"))).toEqual({
      paramType: ParameterType.Tuple,
      operator: Operator.Pass,
      children: [pass(ParameterType.Static), pass(ParameterType.Static)],
    })
    // T[2][] is a dynamic array of 2-tuples, T[][2] a pair of arrays
    expect(describeStructure(ParamType.from("uint8[2][]"))).toEqual({
      paramType: ParameterType.Array,
      operator: Operator.Pass,
      children: [
        {
          paramType: ParameterType.Tuple,
          operator: Operator.Pass,
          children: [pass(ParameterType.Static), pass(ParameterType.Static)],
        },
      ],
    })
    expect(describeStructure(ParamType.from("string[][2]")).paramType).toBe(
      ParameterType.Tuple
    )
  })

  it("matches every element, also the ones the scoping leaves out", () => {
    const result = matches([eq(1)])(ParamType.from("uint256[3]"))
    expect(result.paramType).toBe(ParameterType.Tuple)
    expect(result.children).toHaveLength(3)
    expect(result.children![1]).toEqual(pass(ParameterType.Static))
  })

  it("keeps the parameters after a fixed-size array in place", () => {
    const result = calldataMatches(
      [undefined, eq(5)],
      ["uint256[2]", "uint256"]
    )()
    expect(result.children![0]).toEqual({
      paramType: ParameterType.Tuple,
      operator: Operator.Pass,
      children: [pass(ParameterType.Static), pass(ParameterType.Static)],
    })
  })

  it("compares a whole fixed-size array as a tuple", () => {
    const result = eq([1, 2])(ParamType.from("uint256[2]"))
    expect(result.paramType).toBe(ParameterType.Tuple)
    expect(result.children).toHaveLength(2)
  })

  it("rejects every() on fixed-size arrays", () => {
    expect(() => every(eq(1))(ParamType.from("uint256[2]"))).toThrow(
      /dynamic arrays/
    )
    expect(every(eq(1))(ParamType.from("uint256[]")).paramType).toBe(
      ParameterType.Array
    )
  })
})
