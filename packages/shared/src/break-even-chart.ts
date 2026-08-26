/**
 * The geometry behind the Budget Planner's Break-even Analysis chart, ported from
 * the design prototype ("shoWMe All View" → Budget → Break-even Analysis).
 *
 * Two straight lines in ticket-count space: revenue rises from whatever arrives
 * without selling a ticket (bar + sponsorship) up to what a sold-out house brings,
 * while total cost is flat because none of it moves with the door. Where they
 * cross is break-even. That is the whole chart, and its honesty comes from being
 * exactly the arithmetic the KPI band shows, drawn.
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
const WIDTH = 460;
const HEIGHT = 180;
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
  /** `x,y x,y` for the flat total-cost line. */
  readonly costPoints: string;
  /** The region under revenue, left of the crossing — the part still in the red. */
  readonly shadedAreaPoints: string;
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

  // Money that arrives whether or not a ticket sells — the line's intercept.
  const nonTicketRevenue =
    projection.totalRevenue - projection.ticketRevenue > 0n
      ? projection.totalRevenue - projection.ticketRevenue
      : 0n;
  const revenueAtCapacity = averageTicketPrice * BigInt(capacity) + nonTicketRevenue;

  // 10% of headroom above the taller of the two lines, so neither runs along the
  // top edge. `1n` keeps an empty budget from dividing by zero.
  const scaleTop =
    (bigger(revenueAtCapacity, bigger(projection.totalCosts, 1n)) * 110n) / 100n || 1n;

  const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const toX = (tickets: number) => PADDING_LEFT + (tickets / capacity) * plotWidth;
  const toY = (amount: bigint) =>
    PADDING_TOP + (1 - Number(amount) / Number(scaleTop)) * plotHeight;

  // Tickets at the crossing: where price x tickets + non-ticket revenue meets the
  // flat cost line. Clamped to the chart, and reported as absent when it lands on
  // an edge, because a marker at x=0 would claim a crossing that is really "there
  // isn't one in this room".
  const uncovered = projection.totalCosts - nonTicketRevenue;
  const exactBreakEven =
    averageTicketPrice > 0n && uncovered > 0n ? Number(uncovered) / Number(averageTicketPrice) : 0;
  const breakEvenAt = Math.min(Math.max(exactBreakEven, 0), capacity);
  const breakEvenX = toX(breakEvenAt);
  const breakEvenY = toY(averageTicketPrice * BigInt(Math.round(breakEvenAt)) + nonTicketRevenue);

  const baseline = toY(0n);
  return {
    width: WIDTH,
    height: HEIGHT,
    revenuePoints: `${toX(0)},${toY(nonTicketRevenue)} ${toX(capacity)},${toY(revenueAtCapacity)}`,
    costPoints: `${toX(0)},${toY(projection.totalCosts)} ${toX(capacity)},${toY(projection.totalCosts)}`,
    shadedAreaPoints: `${toX(0)},${toY(nonTicketRevenue)} ${breakEvenX},${breakEvenY} ${breakEvenX},${baseline} ${toX(0)},${baseline}`,
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
