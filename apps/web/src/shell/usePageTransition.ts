import { useViewMotion } from "@showme/design-system";

/**
 * Page transition for the app shell: on each route change the incoming page
 * fades and rises a few pixels into place while the sidebar and topbar stay put.
 *
 * The motion itself is `useViewMotion` in the design system, which plays exactly
 * what the `.sm-screen` class plays. This file used to own its own copy — a
 * hand-rolled 10px / 0.4s / power3.out tween — which meant the app had two
 * screen entrances that were nearly but not quite the same, and a route change
 * that took 400ms in a tool people navigate all day. Keeping the wrapper (rather
 * than calling the hook straight from `AppShell`) keeps the shell's vocabulary:
 * the shell has pages, the design system has views.
 *
 * Pass the route key (pathname) so it re-runs on every navigation.
 */
export function usePageTransition(routeKey: string) {
  return useViewMotion(routeKey);
}
