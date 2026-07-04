# DashRate — Design Spec

**Date:** 2026-07-03
**Status:** Approved

## Purpose

A single-page mobile web app for tracking DoorDash session profitability across two vehicles (Tesla, Jeep). Installed via Chrome's "Add to Home Screen" on a Samsung S22+. Fast, one-handed data entry after finishing a dash; a history/summary view to see whether dashing is actually worth it against a target $/hr.

## Architecture

- Single static app, no build step, no framework: one `index.html` with inline `<style>` and `<script>`, vanilla JS only.
- Two additional small files Chrome requires as separate resources:
  - `manifest.json` — PWA manifest (name, icons as embedded SVG data URIs, theme colors, standalone display mode)
  - `sw.js` — minimal service worker that caches the app shell (`index.html`, `manifest.json`) on install, serving from cache when offline. No other assets to cache since the app is self-contained.
- No backend. The only network calls are to the GitHub Gist API for export/import.
- Hosted on GitHub Pages from a new public repo `dashrate` (same pattern as the existing `tanda-manager` project) — this is required for the manifest/install-prompt/service-worker features to work; `file://` URLs only get a degraded bookmark-style shortcut in Chrome.

## Data Model (all in `localStorage`)

- `dashrate_sessions`: array of session records:
  ```
  {
    id,               // timestamp-based unique id
    date,             // 'YYYY-MM-DD'
    vehicle,          // 'Tesla' | 'Jeep'
    startTime,        // 'HH:MM' 24h
    endTime,          // 'HH:MM' 24h
    activeMinutes,    // number
    miles,            // number
    ddPay,            // number
    tips,             // number
    costPerMileSnapshot,   // vehicle cost/mile at time of save
    thresholdSnapshot      // worth-it threshold at time of save
  }
  ```
- `dashrate_settings`:
  ```
  {
    teslaCostPerMile,      // default 0.045
    jeepMode,              // 'calculated' | 'override'
    jeepMpg,
    gasPrice,
    jeepCostPerMileOverride,
    worthItThreshold,      // default 18
    lastVehicle            // 'Tesla' | 'Jeep', for form default
  }
  ```
- `dashrate_gist_token`, `dashrate_gist_id`: set on first export/import use, never hardcoded.

**Key decision — snapshotting:** Each session stores the cost/mile and threshold that were active *at the time it was logged* (`costPerMileSnapshot`, `thresholdSnapshot`). Changing Settings later does not retroactively change past sessions' flags or computed costs — only new sessions use the updated values. This matches expectations for a financial log: history shouldn't silently repaint when you tweak a setting today.

## Calculations

- Total logged minutes = `endTime - startTime`, handling overnight sessions (if `endTime < startTime`, add 24h).
- `grossPay = ddPay + tips`
- `energyCost = miles × costPerMileSnapshot`
- `netPay = grossPay − energyCost`
- `$/hr active = netPay / (activeMinutes / 60)`
- `$/hr total = netPay / (totalLoggedMinutes / 60)`
- Flag: green if `$/hr total ≥ thresholdSnapshot`, else red.
- Jeep cost/mile: if `jeepMode === 'calculated'`, `costPerMile = gasPrice / jeepMpg`; if `'override'`, use `jeepCostPerMileOverride` directly.

## Views

Bottom tab bar with two tabs, sized for one-handed thumb reach:

1. **Log** (default tab): entry form —
   - Date (native date input, defaults to today)
   - Vehicle dropdown (Tesla/Jeep, defaults to `lastVehicle`)
   - Start/End time (native `<input type="time">` — triggers Android's native time picker)
   - Active minutes, Miles, DoorDash pay, Tips (all `inputmode="decimal"` number fields for numeric keyboard)
   - Live-computed preview (net pay, $/hr active, $/hr total, flag color) updates as fields are filled, before saving
   - Large "Save Session" button

2. **History**:
   - Reverse-chronological list of session cards, color-flagged (left border/dot matching green/red flag)
   - Week switcher (◀ current week ▶, Mon–Sun, defaults to week containing most recent session) driving a **weekly summary** block: total gross, total net, total hours, blended $/hr for the selected week
   - **All-time** breakdown tables (not limited to selected week, since patterns are more statistically meaningful over full history):
     - By time-of-day bucket (morning <11am, afternoon 11am–4pm, evening >4pm): average $/hr per bucket
     - By day of week: average $/hr per day

Settings accessible via a gear icon in the top bar, opening a sheet with:
- Tesla cost/mile, Jeep mode toggle (calculated vs override) + mpg/gas price/override fields
- Worth-it threshold
- Export to Gist / Import from Gist buttons, with token entry prompted once on first use

## GitHub Gist Export/Import

- First export prompts for a GitHub Personal Access Token (fine-grained, Gists-only scope recommended). Stored in `localStorage` only, never in source code.
- Single private Gist per install, ID remembered in `dashrate_gist_id`; export does a PATCH (overwrite) to that Gist each time; import GETs that same Gist ID and restores both `dashrate_sessions` and `dashrate_settings`.
- If no Gist ID is stored yet, export creates one (POST) and saves the returned ID.

## Visual Design

- Dark, near-black background; elevated card surfaces with soft shadows; 16px rounded corners; system font stack (San Francisco/Roboto via `-apple-system, Roboto, sans-serif` fallback chain).
- **Electric purple** as the sole UI accent — primary buttons, active nav tab, links/focus states.
- Green/red are reserved *exclusively* for the profitability flag (session cards, live preview, weekly summary indicators) so there's no ambiguity between "brand color" and "this session was profitable."
- Smooth transitions between the two tabs (simple fade/slide, no heavy animation library — CSS transitions only).
- Large tap targets throughout (min 44px), designed for fast one-handed use immediately after a dash.

## Out of Scope (YAGNI)

- No multi-user/auth beyond the single Gist PAT.
- No charts/graphs — text-based summary tables only.
- No editing/deleting sessions in v1 beyond what's needed for basic correction (add simple delete on a session card; full edit form is not required — delete + re-add covers corrections).
- No support for vehicles beyond Tesla/Jeep.
- No offline queueing of Gist API calls — export/import require a live connection; failures show a simple error message.
