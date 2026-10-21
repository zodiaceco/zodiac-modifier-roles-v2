import { Condition, Operator, ParameterType } from "../../types"

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
 * Or children may be reordered unless one charges: the first passing branch
 * decides which allowance is charged.
 */
export const canReorderOr = (children: readonly Condition[]) =>
  !children.some(charges)

/**
 * The node reads a parameter: And/Or/Nor if any child does, other nodes
 * unless their type is None (e.g. EtherWithinAllowance, CallWithinAllowance).
 */
export const isStructural = (c: Condition): boolean =>
  isLogicalOp(c.operator)
    ? (c.children ?? []).some(isStructural)
    : c.paramType !== ParameterType.None
