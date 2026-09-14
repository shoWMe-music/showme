/**
 * The geometry behind the Budget Planner's Break-even Analysis chart, ported from
 * the design prototype ("shoWMe All View" → Budget → Break-even Analysis).
 *
 * Two lines in ticket-count space. Revenue rises from the money that arrives
 * without selling a ticket — a sponsorship, a grant — at the rate one more guest
 * brings: the ticket price PLUS their bar and merch spend. Cost rises too, at the
 * rate of selling one more ticket, because the provider takes its cut per
 * transaction. Where they cross is break-even.
 *
 * NEITHER LINE IS FLAT, and the cost line used to be (decisions #23). Drawing it
 * flat at the planned night's total charged a full forecast's processing fees
 * against every attendance on the axis, and put the bar's whole take on the
 * intercept as though it arrived before the doors opened. The crossing it drew
 * was not the crossing the KPI band reported.
 *
 * Its honesty comes from being exactly the arithmetic the KPI band shows, drawn —
 * so the break-even marker is `projection.breakEvenTickets`, never a second
 * calculation of the same thing.
 *
 * Framework-agnostic (CLAUDE.md): this returns numbers and SVG point strings, and
 * the component renders them. Nothing here knows it is inside React, and the
 * screen derives none of it.
 *
 * PIXELS, NOT MONEY. Everything crossing the boundary into this module is bigint
 * minor units (money.md); everything leaving it is a coordinate in a 460x180
 * viewBox. `Number()` appears only in that conversion — a ratio of two amounts,
 * which is exactly where a float is safe and a bigint is useless.
 */

import type { BudgetProjection } from "./budget-planning";

/** The prototype's viewBox and padding, kept so the drawing matches shot-for-shot. */
// The prototype's own viewBox (design-spec-budget-planner-2026-09-13.md). Was
// 460x180, which is a squatter box than the design draws and forced the
// component to stretch it — distorting the stroke widths along with everything
// else. Matching the ratio lets the chart scale honestly.
const WIDTH = 700;
const HEIGHT = 210;
const PADDING_LEFT = 8;
const PADDING_RIGHT = 8;
const PADDING_TOP = 10;
const PADDING_BOTTOM = 10;

/**
 * The x-axis when the operator has not said how big the room is. A chart needs an
 * axis to draw on, and 1 000 tickets is the prototype's stand-in; the screen still
 * labels the axis with the capacity it actually has.
 */
const ASSUMED_CAPACITY = 1000;

export interface BreakEvenChartInputs {
  readonly projection: BudgetProjection;
  readonly capacity: number;
  /**
   * The price to slope the revenue line with before any tier has a quantity — the
   * first tier's price. Without it a half-filled form draws a flat line at zero,
   * which reads as "this show earns nothing" rather than "you haven't finished
   * typing".
   */
  readonly fallbackTicketPrice?: bigint;
}

export interface BreakEvenChart {
  readonly width: number;
  readonly height: number;
  /** `x,y x,y` for the revenue polyline: from no tickets sold to a sold-out house. */
  readonly revenuePoints: string;
  /** `x,y x,y` for the total-cost line, sloped by the per-ticket provider charge. */
  readonly costPoints: string;
  /**
   * The two wedges BETWEEN the lines: where cost is above revenue, and where
   * revenue is above cost. Either is `null` when it has no area.
   *
   * This replaced a single region drawn under the revenue line down to the
   * baseline, which shaded the wrong thing — the area under revenue is takings,
   * and takings are not a loss. The gap between the lines is the loss (or the
   * profit), which is the quantity the chart exists to show.
   */
  readonly lossAreaPoints: string | null;
  readonly profitAreaPoints: string | null;
  readonly breakEvenX: number;
  readonly breakEvenY: number;
  readonly guideTop: number;
  readonly guideBottom: number;
  /**
   * False when the crossing is off the chart — a show that breaks even before it
   * opens its doors, or one that cannot break even inside the room it booked. The
   * marker is hidden rather than pinned to an edge it does not sit on.
   */
  readonly hasBreakEven: boolean;
  /** Tickets at the crossing, rounded — what the footer labels the marker with. */
  readonly breakEvenTickets: number;
  /** The x-axis end label: the capacity actually being drawn against. */
  readonly capacity: number;
  /**
   * The horizontal rules and what each one is worth.
   *
   * `amount` is MONEY, not a label: this module deals in coordinates and the
   * caller owns the currency (see the header note). Handing back a formatted
   * string here would put a second money formatter in the codebase, and the
   * currency peek would silently stop applying to the chart.
   */
  readonly gridLines: readonly { readonly y: number; readonly amount: bigint }[];
  /** Where the operator's own forecast sits, or null when it is off the chart. */
  readonly plannedX: number | null;
}

export function computeBreakEvenChart(inputs: BreakEvenChartInputs): BreakEvenChart {
  const { projection } = inputs;
  const capacity = Math.max(
    1,
    Math.trunc(inputs.capacity) || projection.ticketsSold || ASSUMED_CAPACITY,
  );

  // The slope of the revenue line. The projection's average is quantity-weighted
  // and is the right number the moment any tier has a quantity; the fallback only
  // covers the half-typed form.
  const averageTicketPrice =
    projection.averageTicketPrice > 0n
      ? projection.averageTicketPrice
      : (inputs.fallbackTicketPrice ?? 0n);

  /**
   * The two lines, as functions of attendance rather than a pair of endpoints.
   * Every term is evaluated at the `t` being drawn, which is the fix: a rate that
   * moves with the door has to be asked for the attendance it is being drawn at,
   * not the one the operator happens to have forecast.
   */
  const revenuePerHead = averageTicketPrice + projection.perHeadRevenue;
  const revenueAt = (tickets: number): bigint =>
    revenuePerHead * BigInt(tickets) + projection.standingRevenue;
  const costAt = (tickets: number): bigint =>
    projection.enteredCosts + projection.variableCostPerTicket * BigInt(tickets);

  const revenueAtCapacity = revenueAt(capacity);
  const costAtCapacity = costAt(capacity);

  // 10% of headroom above the taller of the two lines, so neither runs along the
  // top edge. `1n` keeps an empty budget from dividing by zero.
  const scaleTop = (bigger(revenueAtCapacity, bigger(costAtCapacity, 1n)) * 110n) / 100n || 1n;

  const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const toX = (tickets: number) => PADDING_LEFT + (tickets / capacity) * plotWidth;
  const toY = (amount: bigint) =>
    PADDING_TOP + (1 - Number(amount) / Number(scaleTop)) * plotHeight;

  /**
   * The crossing is the KPI band's figure, clamped to the room. Deliberately NOT
   * recomputed here: two numbers for one thing on one screen is how a screen
   * loses an operator's trust, and the projection already solved it against every
   * term that moves.
   */
  const breakEvenAt = Math.min(Math.max(projection.breakEvenTickets, 0), capacity);
  const breakEvenX = toX(breakEvenAt);
  const breakEvenY = toY(revenueAt(breakEvenAt));

  // Three rules — nothing, half, and the top of the scale. Enough to read a
  // figure off the chart; more would be a table with lines through it.
  const gridLines = [0n, scaleTop / 2n, scaleTop].map((amount) => ({ y: toY(amount), amount }));
  const planned = projection.ticketsSold;

  /**
   * Both lines are straight, so each wedge is a triangle when they cross inside
   * the room and a quadrilateral across the whole width when they do not.
   *
   * Which side is which follows from the lines, never from `hasBreakEven`: a show
   * that is already profitable at the door and one that can never break even both
   * report "no crossing", and colouring them the same would tell an operator the
   * opposite of the truth in one of the two cases.
   */
  const leftRevenue = toY(projection.standingRevenue);
  const leftCost = toY(costAt(0));
  const rightRevenue = toY(revenueAtCapacity);
  const rightCost = toY(costAtCapacity);
  const left = toX(0);
  const right = toX(capacity);
  const crosses = breakEvenAt > 0 && breakEvenAt < capacity;
  // Up the page is a smaller y, so revenue is ABOVE cost when its y is smaller.
  // THE TIE MATTERS. A show with no costs entered has both lines starting on the
  // baseline, and "revenue is not strictly above cost at x=0" would call the
  // whole chart a loss while the revenue line climbs away from a flat zero. When
  // the left edge is level, the right edge is the one that decides.
  const startsInProfit =
    leftRevenue < leftCost || (leftRevenue === leftCost && rightRevenue < rightCost);
  const wedges = crosses
    ? {
        lossAreaPoints: `${left},${leftRevenue} ${breakEvenX},${breakEvenY} ${left},${leftCost}`,
        profitAreaPoints: `${breakEvenX},${breakEvenY} ${right},${rightRevenue} ${right},${rightCost}`,
      }
    : {
        lossAreaPoints: startsInProfit
          ? null
          : `${left},${leftRevenue} ${right},${rightRevenue} ${right},${rightCost} ${left},${leftCost}`,
        profitAreaPoints: startsInProfit
          ? `${left},${leftRevenue} ${right},${rightRevenue} ${right},${rightCost} ${left},${leftCost}`
          : null,
      };

  return {
    gridLines,
    // The forecast, drawn only when it is inside the room. A guide pinned to the
    // edge would claim a plan the operator has not made.
    plannedX: planned > 0 && planned <= capacity ? toX(planned) : null,
    width: WIDTH,
    height: HEIGHT,
    revenuePoints: `${toX(0)},${toY(projection.standingRevenue)} ${toX(capacity)},${toY(revenueAtCapacity)}`,
    costPoints: `${toX(0)},${toY(costAt(0))} ${toX(capacity)},${toY(costAtCapacity)}`,
    ...wedges,
    breakEvenX,
    breakEvenY,
    guideTop: PADDING_TOP,
    guideBottom: HEIGHT - PADDING_BOTTOM,
    hasBreakEven: breakEvenAt > 0 && breakEvenAt < capacity,
    // The KPI band's figure, not a second rounding of the same crossing: two
    // numbers for one thing on one screen is how a screen loses an operator's
    // trust. `breakEvenTickets` rounds a part ticket UP, because half a ticket
    // does not pay half a fee.
    breakEvenTickets: projection.breakEvenTickets,
    capacity,
  };
}

function bigger(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
