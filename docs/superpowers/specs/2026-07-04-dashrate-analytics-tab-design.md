# DashRate — Analytics Tab Design Spec

**Date:** 2026-07-04
**Status:** Approved

## Purpose

History already answers "what happened" via text/table summaries (weekly totals, time-of-day and day-of-week breakdown tables). It doesn't answer "how am I doing" at a glance — that requires reading numbers, not seeing a shape. This adds an Analytics tab: three small hand-rolled bar charts for quick visual glanceability, matching the user's stated goal ("I want to quickly glance at a page and see the stats").

## Scope

Three charts, one screen, no new dependencies (still a vanilla HTML/CSS/JS app — charts are hand-rolled inline SVG, no charting library):

1. **$/hr by day of week** — all-time, one bar per weekday (Monday–Sunday). Reuses the existing, already-tested `DashRateCalc.breakdownByDayOfWeek`.
2. **Weekly trend** — blended $/hr for the last 8 calendar weeks, oldest-to-newest left to right. A week with zero logged sessions renders as an empty/gray bar rather than a "$0" bar, so "didn't dash that week" is visually distinct from "dashed and it went badly."
3. **Tesla vs. Jeep** — blended $/hr per vehicle, all-time, two bars side by side.

## New calc.js Functions (pure, unit-tested — same pattern as existing aggregations)

- `weeklyTrend(sessions, weekCount, anchorDate)` → array of `{ weekStart, weekEnd, blendedRate, hasData }`, ordered oldest-to-newest, `weekCount` entries. `hasData` is `false` (and `blendedRate` is `0`) for weeks with no sessions; `true` otherwise. Internally walks backward from `anchorDate` in 7-day steps using the existing `getWeekRange`, filtering sessions per week and reusing `summarizeSessions` for the blended rate.
- `breakdownByVehicle(sessions)` → `{ Tesla: avgOrNull, Jeep: avgOrNull }`, averaging each session's `rateTotal` (via `computeSession`) grouped by `vehicle`, `null` for a vehicle with zero sessions. Same shape/null-handling convention as the existing `breakdownByBucket`/`breakdownByDayOfWeek`.
- Day-of-week chart needs no new function — it calls the existing `breakdownByDayOfWeek` directly.

## Color Semantics

Every bar is green or red depending on whether its value meets the user's **current** worth-it threshold (`settings.worthItThreshold`) at render time — this is the same green/red profitability-flag meaning used everywhere else in the app, just visualized as bar color instead of a dot/border. A bar with `hasData: false` (empty week) renders in a neutral gray, distinct from both green and red, so "no data" is never confused with "red = bad." Electric purple is never used to encode chart data — it stays reserved for UI controls, per the app's existing design constraint.

## Rendering

One shared helper, `renderBarChart(containerId, items)`, where `items` is an array of `{ label, value, hasData }`. It builds the SVG `<rect>` elements (bar heights scaled to the container, proportional to `value`, colored per the rule above) and axis labels, and is called by all three charts — each chart's own code is only "compute the data, call the shared renderer," keeping the three visualizations DRY.

## Placement

A third tab: `Log | History | Analytics`, using the existing `showTab` pattern (extend it from two tabs to three; no structural change to how tab-switching works, just a third button/section pair).

## Out of Scope (YAGNI)

- No chart interactivity (tapping/hovering a bar for exact values) — labels/values are shown directly on or near each bar instead.
- No configurable trend window (the "last 8 weeks" is fixed, not a user setting).
- No additional chart types beyond the three above (e.g., no line charts, no pie charts).
