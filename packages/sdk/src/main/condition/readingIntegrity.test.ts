import { expect, it, suite } from "vitest"
import { Operator, ParameterType } from "../types"

import { abiEncode } from "../abiEncode"
import { c } from "../target/authoring"
import { checkRootConditionIntegrity } from "./conditionIntegrity"
import { conditionHash } from "./conditionId"
import { normalizeCondition } from "./normalize"
import { targetIntegrity } from "../target/integrity"
import { Clearance, ExecutionOptions } from "../types"
import {
  READING_INTEGRITY_DOCS,
  ReadingIntegrityError,
  checkReadingIntegrity,
} from "./readingIntegrity"

/** Bitmask compValue: 2-byte shift, 15-byte mask, 15-byte expected. */
const bitmask = (mask: string, expected: string) =>
  `0x0000${mask.slice(2).padEnd(30, "0")}${expected
    .slice(2)
    .padEnd(30, "0")}` as `0x${string}`

suite("checkReadingIntegrity()", () => {
  it("accepts calldataMatches at the top level", () => {
    const condition = c.calldataMatches([1], ["uint256"])()
    expect(() => checkReadingIntegrity(condition)).not.to.throw()
  })

  it("accepts calldataMatches branches of a top-level or", () => {
    const condition = {
      paramType: ParameterType.None,
      operator: Operator.Or,
      children: [
        c.calldataMatches([1], ["uint256"])(),
        c.calldataMatches([2], ["uint256"])(),
      ],
    }
    expect(() => checkReadingIntegrity(condition)).not.to.throw()
  })

  it("rejects calldataMatches on a bytes parameter", () => {
    const condition = c.calldataMatches(
      [c.calldataMatches([1], ["uint256"], { selector: "0xdeadbeef" })],
      ["bytes"]
    )()
    expect(() => checkReadingIntegrity(condition)).to.throw(
      "The condition checks calldata nested in a `bytes` parameter."
    )
  })

  it("rejects abiEncodedMatches on a bytes parameter", () => {
    const condition = c.calldataMatches(
      [c.abiEncodedMatches([1], ["uint256"])],
      ["bytes"]
    )()
    expect(() => checkReadingIntegrity(condition)).to.throw(
      "The condition checks calldata nested in a `bytes` parameter."
    )
  })

  it("rejects nested calldata inside an or on a bytes parameter", () => {
    const condition = {
      paramType: ParameterType.Calldata,
      operator: Operator.Matches,
      children: [
        {
          paramType: ParameterType.None,
          operator: Operator.Or,
          children: [
            {
              paramType: ParameterType.AbiEncoded,
              operator: Operator.Matches,
              children: [
                {
                  paramType: ParameterType.Static,
                  operator: Operator.EqualTo,
                  compValue: abiEncode(["uint256"], [1]),
                },
              ],
            },
          ],
        },
      ],
    }
    expect(() => checkReadingIntegrity(condition)).to.throw(
      "The condition checks calldata nested in a `bytes` parameter."
    )
  })

  it("accepts c.eq on a bytes parameter", () => {
    const condition = c.calldataMatches([c.eq("0xdeadbeef")], ["bytes"])()
    expect(() => checkReadingIntegrity(condition)).not.to.throw()
  })

  it("accepts a selector bitmask on a bytes value", () => {
    const condition = {
      paramType: ParameterType.Calldata,
      operator: Operator.Matches,
      children: [
        {
          paramType: ParameterType.Dynamic,
          operator: Operator.Bitmask,
          compValue: bitmask("0xffffffff", "0xdeadbeef"),
        },
      ],
    }
    expect(() => checkReadingIntegrity(condition)).not.to.throw()
  })

  it("rejects a bitmask on a bytes value expecting its last checked bytes to be zero", () => {
    const condition = {
      paramType: ParameterType.Calldata,
      operator: Operator.Matches,
      children: [
        {
          paramType: ParameterType.Dynamic,
          operator: Operator.Bitmask,
          compValue: bitmask("0xffffffff", "0x12345600"),
        },
      ],
    }
    expect(() => checkReadingIntegrity(condition)).to.throw(
      "The condition has a `bitmask` on a `bytes` value that expects the last bytes it checks to be zero."
    )
  })

  const onBytes = (mask: string, expected: string) => ({
    paramType: ParameterType.Calldata,
    operator: Operator.Matches,
    children: [
      {
        paramType: ParameterType.Dynamic,
        operator: Operator.Bitmask,
        compValue: bitmask(mask, expected),
      },
    ],
  })

  it.each([
    ["a zero byte before a non-zero one", "0xffffffff", "0x12003456"],
    ["a zero first byte", "0xffffffff", "0x00345678"],
    ["an unchecked last byte", "0xffffff00", "0x12345600"],
  ])("accepts a bitmask on a bytes value with %s", (_, mask, expected) => {
    expect(() => checkReadingIntegrity(onBytes(mask, expected))).not.to.throw()
  })

  it.each([
    ["only zero bytes", "0xffffffff", "0x00000000"],
    ["zero bytes after the first", "0xffffffff", "0x12000000"],
    ["zero bits in a partly checked last byte", "0xff0f", "0x1200"],
  ])("rejects a bitmask on a bytes value expecting %s", (_, mask, expected) => {
    expect(() => checkReadingIntegrity(onBytes(mask, expected))).to.throw(
      ReadingIntegrityError
    )
  })

  it("accepts a bitmask on a static value expecting zero bytes", () => {
    const condition = {
      paramType: ParameterType.Calldata,
      operator: Operator.Matches,
      children: [
        {
          paramType: ParameterType.Static,
          operator: Operator.Bitmask,
          compValue: bitmask("0xffffffff", "0x12000000"),
        },
      ],
    }
    expect(() => checkReadingIntegrity(condition)).not.to.throw()
  })

  it("runs as part of checkRootConditionIntegrity", () => {
    const condition = c.calldataMatches(
      [c.calldataMatches([1], ["uint256"])],
      ["bytes"]
    )()
    expect(() => checkRootConditionIntegrity(condition)).to.throw(
      "The condition checks calldata nested in a `bytes` parameter."
    )
  })

  const nested = () =>
    c.calldataMatches(
      [c.calldataMatches([1], ["uint256"], { selector: "0xdeadbeef" })],
      ["bytes"]
    )()

  it("points to the docs and reports the condition hash", () => {
    const condition = nested()
    const hash = conditionHash(normalizeCondition(condition))
    try {
      checkReadingIntegrity(condition)
      expect.unreachable()
    } catch (e) {
      expect(e).to.be.instanceOf(ReadingIntegrityError)
      expect((e as ReadingIntegrityError).conditionHash).to.equal(hash)
      expect((e as Error).message).to.contain(READING_INTEGRITY_DOCS)
      expect((e as Error).message).to.contain(hash)
    }
  })

  it("passes an acknowledged condition", () => {
    const condition = nested()
    const hash = conditionHash(normalizeCondition(condition))
    expect(() =>
      checkReadingIntegrity(condition, { acknowledged: [hash] })
    ).not.to.throw()
  })

  it("acknowledges the same condition before and after normalization", () => {
    const condition = nested()
    const hash = conditionHash(normalizeCondition(condition))
    expect(() =>
      checkReadingIntegrity(normalizeCondition(condition), {
        acknowledged: [hash],
      })
    ).not.to.throw()
  })

  it("does not pass other conditions", () => {
    expect(() =>
      checkReadingIntegrity(nested(), { acknowledged: ["0x1234"] })
    ).to.throw(ReadingIntegrityError)
  })

  const targetsWith = (address: `0x${string}`) => [
    {
      address,
      clearance: Clearance.Function,
      executionOptions: ExecutionOptions.None,
      functions: [
        {
          selector: "0x12345678" as const,
          executionOptions: ExecutionOptions.None,
          wildcarded: false,
          condition: nested(),
        },
      ],
    },
  ]

  const acknowledgementFor = (
    targets: Parameters<typeof targetIntegrity>[0]
  ) => {
    try {
      targetIntegrity(targets)
    } catch (e) {
      expect(e).to.be.instanceOf(ReadingIntegrityError)
      return (e as ReadingIntegrityError).acknowledgement
    }
    return expect.unreachable()
  }

  it("passes acknowledgements through targetIntegrity", () => {
    const targets = targetsWith("0x1111111111111111111111111111111111111111")
    const acknowledgement = acknowledgementFor(targets)
    expect(() =>
      targetIntegrity(targets, { acknowledged: [acknowledgement] })
    ).not.to.throw()
  })

  it("acknowledges a condition for its own target and function only", () => {
    const first = targetsWith("0x1111111111111111111111111111111111111111")
    const second = targetsWith("0x2222222222222222222222222222222222222222")
    const acknowledgement = acknowledgementFor(first)

    expect(acknowledgementFor(second)).not.to.equal(acknowledgement)
    expect(() =>
      targetIntegrity(second, { acknowledged: [acknowledgement] })
    ).to.throw(ReadingIntegrityError)
    // nor does the bare condition hash pass a scoped check
    expect(() =>
      targetIntegrity(first, {
        acknowledged: [conditionHash(normalizeCondition(nested()))],
      })
    ).to.throw(ReadingIntegrityError)
  })

  it("acknowledges the same function regardless of address case", () => {
    const lower = targetsWith("0xabababababababababababababababababababab")
    const mixed = targetsWith("0xABabababababababababababababababababABab")
    expect(acknowledgementFor(mixed)).to.equal(acknowledgementFor(lower))
  })
})
