/**
 * Whether shoWMe offers PRO **filing** yet. It does not.
 *
 * The setlist half of the module is finished and useful on its own — a performer
 * writes the set, the venue reads it on the event — so it stays visible. The
 * filing half (generate the works report, send it to STIM/GEMA/PRS, record that
 * you did) waits on commercial agreements with the societies themselves, and
 * until those exist a "Report to STIM" button is a promise the product cannot
 * keep. Product owner, 2026-08 (ClickUp 86cbaxydb): *"We can make all of the
 * reporting part 'coming soon' until we have a deal with the PROs. Just keep the
 * setlists."*
 *
 * DARK, NOT DELETED. Everything behind the flag works — `usePerformanceReport`,
 * `proFilingExport`, `PerformanceReportModal`, the `performance_reports` route —
 * and is exercised by the API suite. Flipping this to `true` is the whole of
 * turning it back on, which is why it is one exported constant and not a
 * scattering of commented-out JSX.
 *
 * Typed `boolean` on purpose: a `false` literal would let TypeScript narrow the
 * live branch out of existence and quietly rot the code this is protecting.
 */
export const PRO_FILING_AVAILABLE: boolean = false;

/** What a surface says where the filing action would otherwise be. */
export const PRO_FILING_COMING_SOON = "Filing — coming soon";
