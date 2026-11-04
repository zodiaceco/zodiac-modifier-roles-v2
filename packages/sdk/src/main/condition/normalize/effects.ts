import { Condition, Operator, ParameterType } from "../../types"
import { typeTreeId } from "../typeTree"

/**
 * Effects a condition subtree can have on the evaluation of its siblings.
 *
 * The Roles evaluator threads allowance consumptions through And/Or/Matches:
 * a failing branch leaves no trace, but every passing child adds its charge,
 * and an Or keeps the charges of its first passing branch.
 *
 * Normalization may only reorder or drop children when this allows it.
 */

const CHARGING = new Set([
  Operator.WithinAllowance,
  Operator.EtherWithinAllowance,
  Operator.CallWithinAllowance,
])

/** Nor (operator 3): not in the SDK's Operator enum, but valid on chain. */
const NOR = 3 as Operator

const isLogicalOp = (op: Operator) =>
  op === Operator.And || op === Operator.Or || op === NOR

const has = (c: Condition, pred: (op: Operator) => boolean): boolean =>
  pred(c.operator) || (c.children ?? []).some((child) => has(child, pred))

/** The subtree may charge an allowance when it passes. */
export const charges = (c: Condition) => has(c, (op) => CHARGING.has(op))

/**
 * The subtree has an Or (or Nor) over branches that charge: whether a branch
 * passes, and so what is charged, depends on earlier charges.
 */
export const choosesCharge = (c: Condition): boolean =>
  ((c.operator === Operator.Or || c.operator === NOR) && charges(c)) ||
  (c.children ?? []).some(choosesCharge)

/**
 * And children may be reordered: charges add up the same in any order, as
 * long as no choice depends on what was charged before. A child that picks
 * among charging branches (Or[W1, W2]) must be the only child that charges.
 */
export const canReorderAnd = (children: readonly Condition[]) =>
  children.filter(charges).length <= 1 || !children.some(choosesCharge)

/**
 * Or children may be reordered if none charges, or if every charging child
 * excludes every other child: the first passing branch decides which
 * allowance is charged, and with at most one passing branch its position
 * does not matter. (The rule of zodiac-modifier-roles v3, proven there in
 * packages/evm/formal/Normalize/Exclusive.lean.)
 *
 * Why at most one branch passes, in the v2 PermissionChecker: `_or` hands
 * every branch the same payload, and a failing branch keeps no
 * consumptions (charges copy on write, failures return the consumptions
 * they started with); `_matches` pairs children with payload fields by
 * index; a static `EqualTo` compares the keccak256 of the 32-byte word with
 * that of its compValue (different words never both pass, barring a
 * keccak256 collision).
 */
export const canReorderOr = (children: readonly Condition[]) => {
  const charging = children.map(charges)
  if (!charging.some(Boolean)) return true

  const trees = children.map(typeTreeOf)
  const excludes = (i: number, j: number) =>
    trees[i] !== undefined &&
    trees[i] === trees[j] &&
    disjoint(children[i], children[j])

  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      if (charging[i] && !excludes(i, j)) return false
      if (charging[j] && !excludes(j, i)) return false
    }
  }
  return true
}

/**
 * No payload passes both conditions, checked against the same payload:
 * - And: one of its children is disjoint from the other side;
 * - Or: every one of its children is;
 * - Matches of the same type and width: two children at the same position
 *   are (they check the same payload field; None-typed children take
 *   payload fields in v2 too, so the pairing is by raw index);
 * - static EqualTo on one 32-byte word, with no children: the words differ.
 */
const disjoint = (a: Condition, b: Condition): boolean => {
  const as = a.children ?? []
  const bs = b.children ?? []

  if (a.operator === Operator.And) return as.some((x) => disjoint(x, b))
  if (b.operator === Operator.And) return bs.some((y) => disjoint(a, y))
  if (a.operator === Operator.Or) return as.every((x) => disjoint(x, b))
  if (b.operator === Operator.Or) return bs.every((y) => disjoint(a, y))

  if (a.operator === Operator.Matches && b.operator === Operator.Matches) {
    return (
      a.paramType === b.paramType &&
      as.length === bs.length &&
      as.some((x, i) => disjoint(x, bs[i]))
    )
  }

  const x = pinnedWord(a)
  const y = pinnedWord(b)
  return x !== undefined && y !== undefined && x !== y
}

/** The word a static EqualTo with no children pins. */
const pinnedWord = (c: Condition) =>
  c.operator === Operator.EqualTo &&
  c.paramType === ParameterType.Static &&
  (c.children ?? []).length === 0 &&
  /^0x[0-9a-f]{64}$/i.test(c.compValue ?? "")
    ? c.compValue!.toLowerCase()
    : undefined

const typeTreeOf = (c: Condition) => {
  try {
    return typeTreeId(c)
  } catch {
    return undefined
  }
}

/**
 * The node reads a parameter: And/Or/Nor if any child does, other nodes
 * unless their type is None (e.g. EtherWithinAllowance, CallWithinAllowance).
 */
export const isStructural = (c: Condition): boolean =>
  isLogicalOp(c.operator)
    ? (c.children ?? []).some(isStructural)
    : c.paramType !== ParameterType.None
