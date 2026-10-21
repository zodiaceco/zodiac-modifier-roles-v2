import { expect, it, suite } from "vitest"

import { Condition, Operator, ParameterType } from "../../types"
import { conditionId } from "../conditionId"

import { normalizeCondition } from "."

const word = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const
const eq = (n: number): Condition => ({
  paramType: ParameterType.Static,
  operator: Operator.EqualTo,
  compValue: word(n),
})
const allowance = (key: number): Condition => ({
  paramType: ParameterType.Static,
  operator: Operator.WithinAllowance,
  compValue: word(key),
})
const callAllowance = (key: number): Condition => ({
  paramType: ParameterType.None,
  operator: Operator.CallWithinAllowance,
  compValue: word(key),
})
const bytesEq = (hex: `0x${string}`): Condition => ({
  paramType: ParameterType.Dynamic,
  operator: Operator.EqualTo,
  compValue: hex,
})
const calldata = (...children: Condition[]): Condition => ({
  paramType: ParameterType.Calldata,
  operator: Operator.Matches,
  children,
})
const tuple = (...children: Condition[]): Condition => ({
  paramType: ParameterType.Tuple,
  operator: Operator.Matches,
  children,
})
const and = (...children: Condition[]): Condition => ({
  paramType: ParameterType.None,
  operator: Operator.And,
  children,
})
const or = (...children: Condition[]): Condition => ({
  paramType: ParameterType.None,
  operator: Operator.Or,
  children,
})

suite("normalizeCondition() keeps semantics", () => {
  it("compares branches by their full content when merging an Or", () => {
    const t1 = tuple(bytesEq("0xaa"), bytesEq("0xbb0050cc"))
    const t2 = tuple(bytesEq("0xaa0050bb"), bytesEq("0xcc"))
    // the packed id is equal, the conditions are not
    expect(conditionId(t1)).toBe(conditionId(t2))

    const result = normalizeCondition(
      or(calldata(t1, eq(1)), calldata(t2, eq(2)))
    )
    expect(result.operator).toBe(Operator.Or)
    expect(result.children).toHaveLength(2)
  })

  it("keeps the order of Or branches that charge allowances", () => {
    // the first passing branch is charged
    const input = calldata(or(allowance(0xbb), allowance(0xaa)))
    expect(normalizeCondition(input)).toEqual(input)
  })

  it("still sorts Or branches that charge nothing", () => {
    expect(normalizeCondition(calldata(or(eq(2), eq(1))))).toEqual(
      calldata(or(eq(1), eq(2)))
    )
  })

  it("keeps duplicate allowance checks in an And (each one charges)", () => {
    const input = calldata(and(allowance(0xaa), allowance(0xaa)))
    expect(normalizeCondition(input)).toEqual(input)
    // duplicates that charge nothing are still removed
    expect(normalizeCondition(calldata(and(eq(1), eq(1))))).toEqual(
      calldata(eq(1))
    )
  })

  it("keeps the order of an And where a choice depends on earlier charges", () => {
    const choice = or(allowance(0xaa), allowance(0xbb))
    const forward = calldata(and(choice, allowance(0xaa)))
    const backward = calldata(and(allowance(0xaa), choice))
    expect(normalizeCondition(forward)).toEqual(forward)
    expect(normalizeCondition(backward)).toEqual(backward)
  })

  it("does not push an Or into Ands whose shared children differ in count", () => {
    const result = normalizeCondition(
      calldata(
        or(
          and(allowance(0xaa), allowance(0xaa), eq(1)),
          and(allowance(0xaa), eq(2))
        )
      )
    )
    expect(result.children![0].operator).toBe(Operator.Or)
  })

  it("still pushes an Or into Ands that share their other children", () => {
    const result = normalizeCondition(
      calldata(or(and(allowance(0xaa), eq(1)), and(allowance(0xaa), eq(2))))
    )
    expect(result).toEqual(calldata(and(allowance(0xaa), or(eq(1), eq(2)))))
  })

  it("does not merge branches whose differing child charges an allowance", () => {
    const result = normalizeCondition(
      or(calldata(allowance(1), allowance(1)), calldata(eq(5), allowance(1)))
    )
    expect(result.operator).toBe(Operator.Or)
  })

  it("pads the parameter a type tree child describes, past non-parameter children", () => {
    const result = normalizeCondition(
      or(
        calldata(
          or(callAllowance(1), callAllowance(2)),
          tuple(eq(1)),
          tuple(eq(2), eq(3))
        ),
        calldata(tuple(eq(4)), tuple(eq(5), eq(6), eq(7)))
      )
    )
    const f = result.children!.find(
      (b) => b.children![0].paramType === ParameterType.None
    )!
    // the first tuple keeps its one field, the second gets the third one
    expect(f.children![1].children).toHaveLength(1)
    expect(f.children![2].children).toHaveLength(3)
  })

  it("puts calldata branches first even when the branches charge allowances", () => {
    // Integrity requires the structured branch before the dynamic one
    const bytesBranch = and(bytesEq("0xaa"), allowance(0xaa))
    const callBranch = calldata(allowance(0xbb))
    const result = normalizeCondition(or(bytesBranch, callBranch))
    expect(result.children![0].paramType).toBe(ParameterType.Calldata)
  })

  it("does not prune a Pass before a Nor that reads a later parameter", () => {
    const nor: Condition = {
      paramType: ParameterType.None,
      operator: 3 as Operator, // Nor
      children: [eq(2)],
    }
    const pass: Condition = {
      paramType: ParameterType.Static,
      operator: Operator.Pass,
    }
    const input = calldata(eq(1), pass, nor)
    expect(normalizeCondition(input).children).toHaveLength(3)
  })
})
