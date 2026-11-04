import { expect, it, suite } from "vitest"

import { Condition, Operator, ParameterType } from "../../types"
import { conditionId, conditionSortKey } from "../conditionId"

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
    // the sort key is equal, the conditions are not
    expect(conditionSortKey(t1)).toBe(conditionSortKey(t2))
    expect(conditionId(t1)).not.toBe(conditionId(t2))

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
    // dynamic tuples (bytes, ...): padding them moves no other parameter
    const dyn = bytesEq("0x12")
    const result = normalizeCondition(
      or(
        calldata(
          or(callAllowance(1), callAllowance(2)),
          tuple(dyn, eq(1)),
          tuple(dyn, eq(2), eq(3))
        ),
        calldata(tuple(dyn, eq(4)), tuple(dyn, eq(5), eq(6), eq(7)))
      )
    )
    const f = result.children!.find(
      (b) => b.children![0].paramType === ParameterType.None
    )!
    // the first tuple keeps its two fields, the second gets the fourth one
    expect(f.children![1].children).toHaveLength(2)
    expect(f.children![2].children).toHaveLength(4)
  })

  it("never pads a tuple encoded in place: later parameters would move", () => {
    // f((uint), uint) and g((uint, uint)): growing f's tuple to two fields
    // would change where f's second parameter is read
    const result = normalizeCondition(
      or(calldata(tuple(eq(1)), eq(2)), calldata(tuple(eq(3), eq(4))))
    )
    const f = result.children!.find((b) =>
      b.children!.some((c) => c.compValue === word(2))
    )!
    expect(f.children![0].children).toHaveLength(1)
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

const pass: Condition = {
  paramType: ParameterType.Static,
  operator: Operator.Pass,
}
const avatar: Condition = {
  paramType: ParameterType.Static,
  operator: Operator.EqualToAvatar,
}

const permutations = <T>(xs: readonly T[]): T[][] =>
  xs.length <= 1
    ? [[...xs]]
    : xs.flatMap((x, i) =>
        permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [
          x,
          ...p,
        ])
      )

const idOf = (branches: Condition[]) =>
  conditionId(normalizeCondition(structuredClone(or(...branches))))

/** The normalized ids of an Or over `branches`, in every order. */
const idsInEveryOrder = (branches: Condition[]) =>
  new Set(permutations(branches).map(idOf))

/** The normalized ids in some orders: rotated and reversed. */
const idsInSomeOrders = (branches: Condition[]) =>
  new Set(
    branches.flatMap((_, k) => {
      const rotated = [...branches.slice(k), ...branches.slice(0, k)]
      return [idOf(rotated), idOf([...rotated].reverse())]
    })
  )

suite("normalizeCondition() sorts Or branches that exclude each other", () => {
  it("sorts capped branches that pin a parameter to different values", () => {
    const branches = [
      calldata(eq(3), allowance(0xaa)),
      calldata(eq(1), allowance(0xbb)),
      calldata(eq(2), allowance(0xaa)),
    ]
    expect(idsInEveryOrder(branches).size).toBe(1)
  })

  it("keeps the order of capped branches that can both pass", () => {
    const branches = [
      calldata(eq(1), allowance(0xaa)),
      calldata(pass, allowance(0xbb)),
    ]
    expect(idsInEveryOrder(branches).size).toBe(2)
    const input = or(...branches)
    expect(normalizeCondition(structuredClone(input))).toEqual(input)
  })

  it("treats an Or of EqualTo as a set of values", () => {
    expect(
      idsInEveryOrder([
        calldata(or(eq(1), eq(2)), allowance(0xaa)),
        calldata(eq(3), allowance(0xbb)),
      ]).size
    ).toBe(1)
    expect(
      idsInEveryOrder([
        calldata(or(eq(1), eq(2)), allowance(0xaa)),
        calldata(eq(2), allowance(0xbb)),
      ]).size
    ).toBe(2)
  })

  it("finds the exclusion in one child of an And", () => {
    const branches = [
      and(calldata(eq(1), pass), calldata(pass, allowance(0xaa))),
      calldata(eq(2), allowance(0xbb)),
    ]
    expect(idsInEveryOrder(branches).size).toBe(1)
  })

  it("does not compare the words of an EqualTo on a dynamic value", () => {
    const branches = [
      calldata(bytesEq(word(1)), allowance(0xaa)),
      calldata(bytesEq(word(2)), allowance(0xbb)),
    ]
    expect(idsInEveryOrder(branches).size).toBe(2)
  })

  it("keeps the order of branches that charge a call allowance and overlap", () => {
    const branches = [
      and(calldata(eq(1), pass), callAllowance(0xaa)),
      and(calldata(pass, eq(2)), callAllowance(0xbb)),
    ]
    expect(idsInEveryOrder(branches).size).toBe(2)
  })

  it("normalizes CoW signOrder branches (Rise, Arbitrum) to one id", () => {
    // signOrder(GPv2Order.Data order, uint32 validDuration, uint256 feeAmountBP)
    // through delegatecall: sell and buy token pinned, receiver the avatar,
    // the sell amount capped with one allowance per direction
    const [WETH, USDC, USDT0, USDG] = [0x82af, 0xaf88, 0xfd08, 0xe0b8]
    const stables = [USDC, USDT0, USDG]
    const [A, B, C] = [0xa, 0xb, 0xc]
    const order = (sell: number, buy: number[], key: number) =>
      calldata(
        tuple(
          eq(sell), // sellToken
          buy.length === 1 ? eq(buy[0]) : or(...buy.map(eq)), // buyToken
          avatar, // receiver
          allowance(key), // sellAmount
          pass, // buyAmount
          pass, // validTo
          pass, // appData
          eq(0), // feeAmount
          eq(0xf3b2), // kind: sell
          eq(0), // partiallyFillable
          eq(0x5a28), // sellTokenBalance: erc20
          eq(0x5a28) // buyTokenBalance: erc20
        ),
        pass,
        pass
      )
    const branches = [
      order(WETH, stables, A),
      ...stables.map((s) => order(s, [WETH], B)),
      ...stables.map((s) => order(s, stables, C)),
    ]
    expect(branches).toHaveLength(7)
    expect(idsInSomeOrders(branches).size).toBe(1)
  })

  it("normalizes Across deposit branches (Rise, Arbitrum) to one id", () => {
    // deposit(bytes32 depositor, bytes32 recipient, bytes32 inputToken,
    //   bytes32 outputToken, uint256 inputAmount, uint256 outputAmount,
    //   uint256 destinationChainId, bytes32 exclusiveRelayer,
    //   uint32 quoteTimestamp, uint32 fillDeadline,
    //   uint32 exclusivityDeadline, bytes message)
    const USDC = 0xaf88
    const WETH = 0x82af
    const [rebalanceDaily, payoutEthMonthly] = [0xd, 0xe]
    const deposit = (token: number, chain: number, key: number) =>
      calldata(
        avatar,
        eq(0x99), // recipient
        eq(token), // inputToken
        eq(token * 0x10000 + chain), // outputToken on that chain
        allowance(key), // inputAmount
        pass,
        eq(chain), // destinationChainId
        pass,
        pass,
        pass,
        pass,
        bytesEq("0x") // message
      )
    const branches = [1, 10, 8453].flatMap((chain) => [
      deposit(USDC, chain, rebalanceDaily),
      deposit(WETH, chain, payoutEthMonthly),
    ])
    expect(branches).toHaveLength(6)
    expect(idsInSomeOrders(branches).size).toBe(1)
  })
})
