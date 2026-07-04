# DashRate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build DashRate, a single-page installable web app that logs DoorDash sessions, computes per-session profitability, and shows history/weekly/breakdown summaries, backed by localStorage and optional GitHub Gist export/import.

**Architecture:** A pure, unit-tested calculation module (`public/calc.js`) holds all business math (time handling, cost/rate/flag computation, week/day bucketing, aggregation). `public/index.html` is a single-file app shell (inline CSS + JS) that wires that module to the DOM and to `localStorage`; `public/manifest.json` and `public/sw.js` are the two small satellite files Chrome requires for install/offline support. The whole `public/` folder is the deployable unit, pushed verbatim (no build step) to a `gh-pages` branch.

**Tech Stack:** Vanilla HTML/CSS/JS, no framework, no bundler. Node's built-in `node:test` runner for unit tests (zero dependencies). `gh-pages` CLI (devDependency) for deployment. GitHub Pages for hosting.

## Global Constraints

- Tesla cost per mile default: `0.045`.
- Jeep cost per mile: default is calculated from MPG + gas price; a direct override must also be supported.
- Worth-it threshold default: `18` ($/hr).
- Time-of-day buckets: morning = before 11:00, afternoon = 11:00–16:00, evening = after 16:00.
- Keep the app itself to a single HTML file where possible; no external dependencies beyond what's essential (no CDN libraries, no frameworks).
- All session/settings data lives in `localStorage` only — no backend.
- Dark-mode-first UI, electric purple as the only UI accent color; green/red are reserved exclusively for the profitability flag.
- GitHub PAT for Gist export/import is entered once by the user and stored only in `localStorage`, never in source code.
- Numeric fields must use `inputmode="decimal"`/`"numeric"` to trigger Android's numeric keyboard; time fields must use native `<input type="time">`.

---

### Task 1: Core time & cost math in `calc.js` (TDD)

**Files:**
- Create: `public/calc.js`
- Test: `test/calc.test.js`

**Interfaces:**
- Produces: `DashRateCalc.parseTimeToMinutes(timeStr) -> number`, `DashRateCalc.computeLoggedMinutes(startTime, endTime) -> number`, `DashRateCalc.computeJeepCostPerMile(settings) -> number` where `settings = { jeepMode: 'calculated'|'override', jeepMpg, gasPrice, jeepCostPerMileOverride }`.

- [ ] **Step 1: Write the failing tests**

Create `test/calc.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTimeToMinutes, computeLoggedMinutes, computeJeepCostPerMile } = require('../public/calc.js');

test('parseTimeToMinutes converts HH:MM to minutes since midnight', () => {
  assert.equal(parseTimeToMinutes('00:00'), 0);
  assert.equal(parseTimeToMinutes('09:30'), 570);
  assert.equal(parseTimeToMinutes('23:59'), 1439);
});

test('computeLoggedMinutes returns end minus start for same-day sessions', () => {
  assert.equal(computeLoggedMinutes('14:00', '16:30'), 150);
});

test('computeLoggedMinutes wraps past midnight when end is before start', () => {
  assert.equal(computeLoggedMinutes('23:30', '00:15'), 45);
});

test('computeLoggedMinutes returns 0 when start equals end', () => {
  assert.equal(computeLoggedMinutes('12:00', '12:00'), 0);
});

test('computeJeepCostPerMile calculates from mpg and gas price when mode is calculated', () => {
  const settings = { jeepMode: 'calculated', jeepMpg: 20, gasPrice: 3.60, jeepCostPerMileOverride: 0.5 };
  assert.equal(computeJeepCostPerMile(settings), 3.60 / 20);
});

test('computeJeepCostPerMile uses the override value when mode is override', () => {
  const settings = { jeepMode: 'override', jeepMpg: 20, gasPrice: 3.60, jeepCostPerMileOverride: 0.22 };
  assert.equal(computeJeepCostPerMile(settings), 0.22);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test`
Expected: FAIL — `Cannot find module '../public/calc.js'`

- [ ] **Step 3: Create `public/calc.js` with the minimal implementation**

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DashRateCalc = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function parseTimeToMinutes(timeStr) {
    var parts = timeStr.split(':');
    var hours = parseInt(parts[0], 10);
    var minutes = parseInt(parts[1], 10);
    return hours * 60 + minutes;
  }

  function computeLoggedMinutes(startTime, endTime) {
    var start = parseTimeToMinutes(startTime);
    var end = parseTimeToMinutes(endTime);
    var diff = end - start;
    if (diff < 0) {
      diff += 24 * 60;
    }
    return diff;
  }

  function computeJeepCostPerMile(settings) {
    if (settings.jeepMode === 'override') {
      return settings.jeepCostPerMileOverride;
    }
    return settings.gasPrice / settings.jeepMpg;
  }

  return {
    parseTimeToMinutes: parseTimeToMinutes,
    computeLoggedMinutes: computeLoggedMinutes,
    computeJeepCostPerMile: computeJeepCostPerMile
  };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add public/calc.js test/calc.test.js
git commit -m "feat: add time and vehicle-cost calculations"
```

---

### Task 2: Per-session computation in `calc.js` (TDD)

**Files:**
- Modify: `public/calc.js`
- Modify: `test/calc.test.js`

**Interfaces:**
- Consumes: `computeLoggedMinutes` from Task 1.
- Produces: `DashRateCalc.computeSession(session) -> { totalLoggedMinutes, grossPay, energyCost, netPay, rateActive, rateTotal, flag }` where `session = { startTime, endTime, activeMinutes, miles, ddPay, tips, costPerMileSnapshot, thresholdSnapshot }` and `flag` is `'green'|'red'`.

- [ ] **Step 1: Write the failing tests**

Append to `test/calc.test.js`:

```js
test('computeSession computes gross, energy cost, net pay, and both rates for a same-day session', () => {
  const session = {
    startTime: '10:00',
    endTime: '12:00',
    activeMinutes: 90,
    miles: 20,
    ddPay: 25,
    tips: 10,
    costPerMileSnapshot: 0.045,
    thresholdSnapshot: 18
  };
  const { computeSession } = require('../public/calc.js');
  const result = computeSession(session);
  assert.equal(result.totalLoggedMinutes, 120);
  assert.equal(result.grossPay, 35);
  assert.equal(result.energyCost, 20 * 0.045);
  assert.equal(result.netPay, 35 - (20 * 0.045));
  assert.equal(result.rateActive, (35 - (20 * 0.045)) / (90 / 60));
  assert.equal(result.rateTotal, (35 - (20 * 0.045)) / (120 / 60));
  assert.equal(result.flag, 'red');
});

test('computeSession flags green when the total-time rate meets the threshold', () => {
  const { computeSession } = require('../public/calc.js');
  const session = {
    startTime: '10:00',
    endTime: '11:00',
    activeMinutes: 60,
    miles: 5,
    ddPay: 15,
    tips: 5,
    costPerMileSnapshot: 0.045,
    thresholdSnapshot: 18
  };
  const result = computeSession(session);
  assert.equal(result.rateTotal, result.netPay);
  assert.equal(result.flag, 'green');
});

test('computeSession returns 0 rates instead of Infinity when minutes are 0', () => {
  const { computeSession } = require('../public/calc.js');
  const session = {
    startTime: '10:00',
    endTime: '10:00',
    activeMinutes: 0,
    miles: 0,
    ddPay: 10,
    tips: 0,
    costPerMileSnapshot: 0.045,
    thresholdSnapshot: 18
  };
  const result = computeSession(session);
  assert.equal(result.totalLoggedMinutes, 0);
  assert.equal(result.rateActive, 0);
  assert.equal(result.rateTotal, 0);
  assert.equal(result.flag, 'red');
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test`
Expected: FAIL — `computeSession is not a function`

- [ ] **Step 3: Add `computeSession` to `public/calc.js`**

Replace the `return { ... }` block at the end of the factory function with:

```js
  function computeSession(session) {
    var totalLoggedMinutes = computeLoggedMinutes(session.startTime, session.endTime);
    var grossPay = session.ddPay + session.tips;
    var energyCost = session.miles * session.costPerMileSnapshot;
    var netPay = grossPay - energyCost;
    var rateActive = session.activeMinutes > 0 ? netPay / (session.activeMinutes / 60) : 0;
    var rateTotal = totalLoggedMinutes > 0 ? netPay / (totalLoggedMinutes / 60) : 0;
    var flag = rateTotal >= session.thresholdSnapshot ? 'green' : 'red';
    return {
      totalLoggedMinutes: totalLoggedMinutes,
      grossPay: grossPay,
      energyCost: energyCost,
      netPay: netPay,
      rateActive: rateActive,
      rateTotal: rateTotal,
      flag: flag
    };
  }

  return {
    parseTimeToMinutes: parseTimeToMinutes,
    computeLoggedMinutes: computeLoggedMinutes,
    computeJeepCostPerMile: computeJeepCostPerMile,
    computeSession: computeSession
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add public/calc.js test/calc.test.js
git commit -m "feat: add per-session profitability computation"
```

---

### Task 3: Bucketing, week ranges, and aggregation in `calc.js` (TDD)

**Files:**
- Modify: `public/calc.js`
- Modify: `test/calc.test.js`

**Interfaces:**
- Consumes: `computeSession` from Task 2, `parseTimeToMinutes` from Task 1.
- Produces:
  - `DashRateCalc.bucketForTime(timeStr) -> 'morning'|'afternoon'|'evening'`
  - `DashRateCalc.dayOfWeek(dateStr) -> 'Sunday'..'Saturday'` (dateStr is `'YYYY-MM-DD'`)
  - `DashRateCalc.getWeekRange(dateStr) -> { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }` (Monday–Sunday range containing `dateStr`)
  - `DashRateCalc.summarizeSessions(sessions) -> { totalGross, totalNet, totalHours, blendedRate }`
  - `DashRateCalc.breakdownByBucket(sessions) -> { morning, afternoon, evening }` (each a number or `null` if no sessions in that bucket)
  - `DashRateCalc.breakdownByDayOfWeek(sessions) -> { Sunday, Monday, ..., Saturday }` (each a number or `null`)
  - Each `sessions` array element is a raw session record as defined in Task 2, plus a `date` field (`'YYYY-MM-DD'`).

- [ ] **Step 1: Write the failing tests**

Append to `test/calc.test.js`:

```js
test('bucketForTime classifies times into morning, afternoon, and evening', () => {
  const { bucketForTime } = require('../public/calc.js');
  assert.equal(bucketForTime('06:00'), 'morning');
  assert.equal(bucketForTime('10:59'), 'morning');
  assert.equal(bucketForTime('11:00'), 'afternoon');
  assert.equal(bucketForTime('15:59'), 'afternoon');
  assert.equal(bucketForTime('16:00'), 'evening');
  assert.equal(bucketForTime('23:00'), 'evening');
});

test('dayOfWeek returns the correct weekday name for a given date', () => {
  const { dayOfWeek } = require('../public/calc.js');
  assert.equal(dayOfWeek('2026-07-03'), 'Friday');
  assert.equal(dayOfWeek('2026-06-29'), 'Monday');
  assert.equal(dayOfWeek('2026-07-05'), 'Sunday');
});

test('getWeekRange returns the Monday-Sunday range containing a mid-week date', () => {
  const { getWeekRange } = require('../public/calc.js');
  assert.deepEqual(getWeekRange('2026-07-03'), { start: '2026-06-29', end: '2026-07-05' });
});

test('getWeekRange treats the Monday itself as the start of its own week', () => {
  const { getWeekRange } = require('../public/calc.js');
  assert.deepEqual(getWeekRange('2026-06-29'), { start: '2026-06-29', end: '2026-07-05' });
});

test('getWeekRange treats the Sunday itself as the end of its own week, not the next', () => {
  const { getWeekRange } = require('../public/calc.js');
  assert.deepEqual(getWeekRange('2026-07-05'), { start: '2026-06-29', end: '2026-07-05' });
});

test('summarizeSessions aggregates gross, net, hours, and blended rate across sessions', () => {
  const { computeSession, summarizeSessions } = require('../public/calc.js');
  const sessionA = { startTime: '10:00', endTime: '12:00', activeMinutes: 90, miles: 20, ddPay: 25, tips: 10, costPerMileSnapshot: 0.045, thresholdSnapshot: 18, date: '2026-06-29' };
  const sessionB = { startTime: '13:00', endTime: '14:00', activeMinutes: 50, miles: 10, ddPay: 20, tips: 5, costPerMileSnapshot: 0.18, thresholdSnapshot: 18, date: '2026-06-30' };
  const a = computeSession(sessionA);
  const b = computeSession(sessionB);
  const result = summarizeSessions([sessionA, sessionB]);
  assert.equal(result.totalGross, a.grossPay + b.grossPay);
  assert.equal(result.totalNet, a.netPay + b.netPay);
  assert.equal(result.totalHours, (a.totalLoggedMinutes + b.totalLoggedMinutes) / 60);
  assert.equal(result.blendedRate, (a.netPay + b.netPay) / result.totalHours);
});

test('summarizeSessions returns zeros for an empty list', () => {
  const { summarizeSessions } = require('../public/calc.js');
  assert.deepEqual(summarizeSessions([]), { totalGross: 0, totalNet: 0, totalHours: 0, blendedRate: 0 });
});

test('breakdownByBucket averages rateTotal per time-of-day bucket and returns null for empty buckets', () => {
  const { computeSession, breakdownByBucket } = require('../public/calc.js');
  const morningSession = { startTime: '08:00', endTime: '09:00', activeMinutes: 60, miles: 5, ddPay: 20, tips: 5, costPerMileSnapshot: 0.045, thresholdSnapshot: 18, date: '2026-06-29' };
  const eveningSession = { startTime: '18:00', endTime: '19:00', activeMinutes: 60, miles: 5, ddPay: 20, tips: 5, costPerMileSnapshot: 0.045, thresholdSnapshot: 18, date: '2026-06-29' };
  const morning = computeSession(morningSession);
  const evening = computeSession(eveningSession);
  const result = breakdownByBucket([morningSession, eveningSession]);
  assert.equal(result.morning, morning.rateTotal);
  assert.equal(result.evening, evening.rateTotal);
  assert.equal(result.afternoon, null);
});

test('breakdownByDayOfWeek averages rateTotal per weekday and returns null for days with no sessions', () => {
  const { computeSession, breakdownByDayOfWeek } = require('../public/calc.js');
  const mondaySession = { startTime: '08:00', endTime: '09:00', activeMinutes: 60, miles: 5, ddPay: 20, tips: 5, costPerMileSnapshot: 0.045, thresholdSnapshot: 18, date: '2026-06-29' };
  const monday = computeSession(mondaySession);
  const result = breakdownByDayOfWeek([mondaySession]);
  assert.equal(result.Monday, monday.rateTotal);
  assert.equal(result.Tuesday, null);
  assert.equal(result.Sunday, null);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test`
Expected: FAIL — `bucketForTime is not a function` (and similar for the other new exports)

- [ ] **Step 3: Add the new functions to `public/calc.js`**

Replace the final `return { ... }` block with:

```js
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function parseDateParts(dateStr) {
    var parts = dateStr.split('-');
    return { year: parseInt(parts[0], 10), month: parseInt(parts[1], 10), day: parseInt(parts[2], 10) };
  }

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function formatDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function dayOfWeek(dateStr) {
    var parts = parseDateParts(dateStr);
    var d = new Date(parts.year, parts.month - 1, parts.day);
    return DAY_NAMES[d.getDay()];
  }

  function bucketForTime(timeStr) {
    var minutes = parseTimeToMinutes(timeStr);
    if (minutes < 11 * 60) return 'morning';
    if (minutes < 16 * 60) return 'afternoon';
    return 'evening';
  }

  function getWeekRange(dateStr) {
    var parts = parseDateParts(dateStr);
    var d = new Date(parts.year, parts.month - 1, parts.day);
    var dow = d.getDay();
    var mondayOffset = dow === 0 ? -6 : 1 - dow;
    var monday = new Date(parts.year, parts.month - 1, parts.day + mondayOffset);
    var sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    return { start: formatDate(monday), end: formatDate(sunday) };
  }

  function summarizeSessions(sessions) {
    if (sessions.length === 0) {
      return { totalGross: 0, totalNet: 0, totalHours: 0, blendedRate: 0 };
    }
    var totalGross = 0, totalNet = 0, totalMinutes = 0;
    sessions.forEach(function (s) {
      var c = computeSession(s);
      totalGross += c.grossPay;
      totalNet += c.netPay;
      totalMinutes += c.totalLoggedMinutes;
    });
    var totalHours = totalMinutes / 60;
    var blendedRate = totalHours > 0 ? totalNet / totalHours : 0;
    return { totalGross: totalGross, totalNet: totalNet, totalHours: totalHours, blendedRate: blendedRate };
  }

  function averageRateTotal(sessions) {
    if (sessions.length === 0) return null;
    var sum = sessions.reduce(function (acc, s) { return acc + computeSession(s).rateTotal; }, 0);
    return sum / sessions.length;
  }

  function breakdownByBucket(sessions) {
    var groups = { morning: [], afternoon: [], evening: [] };
    sessions.forEach(function (s) { groups[bucketForTime(s.startTime)].push(s); });
    return {
      morning: averageRateTotal(groups.morning),
      afternoon: averageRateTotal(groups.afternoon),
      evening: averageRateTotal(groups.evening)
    };
  }

  function breakdownByDayOfWeek(sessions) {
    var groups = {};
    DAY_NAMES.forEach(function (d) { groups[d] = []; });
    sessions.forEach(function (s) { groups[dayOfWeek(s.date)].push(s); });
    var result = {};
    DAY_NAMES.forEach(function (d) { result[d] = averageRateTotal(groups[d]); });
    return result;
  }

  return {
    parseTimeToMinutes: parseTimeToMinutes,
    computeLoggedMinutes: computeLoggedMinutes,
    computeJeepCostPerMile: computeJeepCostPerMile,
    computeSession: computeSession,
    bucketForTime: bucketForTime,
    dayOfWeek: dayOfWeek,
    getWeekRange: getWeekRange,
    summarizeSessions: summarizeSessions,
    breakdownByBucket: breakdownByBucket,
    breakdownByDayOfWeek: breakdownByDayOfWeek
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS (17 tests)

- [ ] **Step 5: Commit**

```bash
git add public/calc.js test/calc.test.js
git commit -m "feat: add time-bucket, weekday, and week-range aggregation helpers"
```

---

### Task 4: PWA manifest and service worker

**Files:**
- Create: `public/manifest.json`
- Create: `public/sw.js`
- Test: `test/manifest.test.js`

**Interfaces:**
- Produces: `public/manifest.json` (valid PWA manifest, `name: "DashRate"`, `display: "standalone"`), `public/sw.js` (registers a `dashrate-v1` cache of the app shell).

- [ ] **Step 1: Write the failing test**

Create `test/manifest.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('manifest.json is valid JSON with the required PWA fields', () => {
  const raw = fs.readFileSync(path.join(__dirname, '../public/manifest.json'), 'utf8');
  const manifest = JSON.parse(raw);
  assert.equal(manifest.name, 'DashRate');
  assert.equal(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test`
Expected: FAIL — `ENOENT: no such file or directory ... public/manifest.json`

- [ ] **Step 3: Create `public/manifest.json`**

```json
{
  "name": "DashRate",
  "short_name": "DashRate",
  "start_url": "./index.html",
  "display": "standalone",
  "background_color": "#0b0e14",
  "theme_color": "#0b0e14",
  "orientation": "portrait",
  "icons": [
    {
      "src": "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Crect%20width='100'%20height='100'%20rx='20'%20fill='%238b5cf6'/%3E%3Ctext%20x='50'%20y='68'%20font-size='56'%20font-family='sans-serif'%20font-weight='700'%20text-anchor='middle'%20fill='%23ffffff'%3E$%3C/text%3E%3C/svg%3E",
      "sizes": "any",
      "type": "image/svg+xml"
    }
  ]
}
```

- [ ] **Step 4: Create `public/sw.js`**

```js
var CACHE_NAME = 'dashrate-v1';
var APP_SHELL = ['./', './index.html', './manifest.json'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(APP_SHELL); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (name) { return name !== CACHE_NAME; }).map(function (name) { return caches.delete(name); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  event.respondWith(
    caches.match(event.request).then(function (cached) { return cached || fetch(event.request); })
  );
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test`
Expected: PASS (18 tests)

- [ ] **Step 6: Commit**

```bash
git add public/manifest.json public/sw.js test/manifest.test.js
git commit -m "feat: add PWA manifest and offline service worker"
```

---

### Task 5: App shell — HTML/CSS, tab navigation, and Settings sheet

**Files:**
- Create: `public/index.html`

**Interfaces:**
- Consumes: `public/calc.js` (loaded via `<script src="./calc.js">`, global `DashRateCalc`).
- Produces (globals available to later tasks, defined inside the single inline `<script>` IIFE): `getSettings()`, `saveSettings(settings)`, `getSessions()`, `saveSessions(sessions)`, `showTab(name)`, `fillSettingsForm()`, `resetLogForm()` (stub, implemented Task 6), `renderHistory()` (stub, implemented Task 7), storage key constants `SESSIONS_KEY`, `SETTINGS_KEY`, `GIST_TOKEN_KEY`, `GIST_ID_KEY`, and `DEFAULT_SETTINGS`.

- [ ] **Step 1: Create `public/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#0b0e14">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>DashRate</title>
<link rel="manifest" href="./manifest.json">
<style>
  :root {
    --bg: #0b0e14;
    --surface: #161a24;
    --surface-2: #1e2330;
    --text: #f2f3f7;
    --text-dim: #9aa0ac;
    --accent: #8b5cf6;
    --green: #2fd675;
    --red: #ff4d5e;
    --radius: 16px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    -webkit-tap-highlight-color: transparent;
    padding-bottom: 76px;
  }
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; position: sticky; top: 0; background: var(--bg); z-index: 10;
  }
  header h1 { font-size: 20px; margin: 0; }
  .icon-btn {
    background: var(--surface); border: none; color: var(--text);
    width: 40px; height: 40px; border-radius: 12px; font-size: 18px;
  }
  main { padding: 0 16px; }
  .view { display: none; animation: fadeIn 0.2s ease; }
  .view.active { display: block; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px);} to { opacity: 1; transform: translateY(0);} }
  .card {
    background: var(--surface); border-radius: var(--radius);
    padding: 16px; margin-bottom: 12px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.35);
  }
  label { display: block; font-size: 13px; color: var(--text-dim); margin: 12px 0 6px; }
  input, select {
    width: 100%; padding: 14px; border-radius: 12px; border: 1px solid #2a2f3d;
    background: var(--surface-2); color: var(--text); font-size: 16px;
  }
  .btn-primary {
    width: 100%; padding: 16px; border: none; border-radius: 14px;
    background: var(--accent); color: white; font-size: 17px; font-weight: 600;
    margin-top: 16px;
  }
  .btn-secondary {
    width: 100%; padding: 14px; border: none; border-radius: 14px;
    background: var(--surface-2); color: var(--text); font-size: 15px; font-weight: 600;
    margin-top: 10px;
  }
  .preview-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 15px; }
  .preview-row .label { color: var(--text-dim); }
  .flag-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
  .flag-green { background: var(--green); }
  .flag-red { background: var(--red); }
  .session-card { border-left: 4px solid var(--text-dim); }
  .session-card.green { border-left-color: var(--green); }
  .session-card.red { border-left-color: var(--red); }
  nav.tabbar {
    position: fixed; bottom: 0; left: 0; right: 0; display: flex;
    background: var(--surface); border-top: 1px solid #23283a;
    padding: 8px 0 max(8px, env(safe-area-inset-bottom));
  }
  nav.tabbar button {
    flex: 1; background: none; border: none; color: var(--text-dim);
    font-size: 13px; padding: 8px 0;
  }
  nav.tabbar button.active { color: var(--accent); font-weight: 600; }
  .sheet-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.5);
    display: none; align-items: flex-end; z-index: 20;
  }
  .sheet-overlay.active { display: flex; }
  .sheet {
    background: var(--surface); width: 100%; border-radius: 20px 20px 0 0;
    padding: 20px; max-height: 85vh; overflow-y: auto;
  }
  .week-switcher { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .week-switcher button { background: var(--surface-2); border: none; color: var(--text); width: 40px; height: 40px; border-radius: 10px; font-size: 16px; }
  table.breakdown { width: 100%; border-collapse: collapse; margin-top: 8px; }
  table.breakdown td { padding: 8px 4px; font-size: 14px; border-bottom: 1px solid #23283a; }
  table.breakdown td:last-child { text-align: right; }
</style>
</head>
<body>
  <header>
    <h1>DashRate</h1>
    <button class="icon-btn" id="settings-btn" aria-label="Settings">&#9881;</button>
  </header>
  <main>
    <section id="log-view" class="view active"></section>
    <section id="history-view" class="view"></section>
  </main>
  <nav class="tabbar">
    <button id="tab-log" class="active">Log</button>
    <button id="tab-history">History</button>
  </nav>
  <div class="sheet-overlay" id="settings-overlay">
    <div class="sheet" id="settings-sheet">
      <h2>Settings</h2>
      <label for="set-tesla-cost">Tesla cost per mile ($)</label>
      <input type="number" step="0.001" inputmode="decimal" id="set-tesla-cost">

      <label for="set-jeep-mode">Jeep cost mode</label>
      <select id="set-jeep-mode">
        <option value="calculated">Calculate from MPG + gas price</option>
        <option value="override">Manual override</option>
      </select>

      <label for="set-jeep-mpg">Jeep MPG</label>
      <input type="number" step="0.1" inputmode="decimal" id="set-jeep-mpg">

      <label for="set-gas-price">Gas price ($/gal)</label>
      <input type="number" step="0.01" inputmode="decimal" id="set-gas-price">

      <label for="set-jeep-override">Jeep cost per mile override ($)</label>
      <input type="number" step="0.001" inputmode="decimal" id="set-jeep-override">

      <label for="set-threshold">Worth-it threshold ($/hr)</label>
      <input type="number" step="0.5" inputmode="decimal" id="set-threshold">

      <label for="set-gist-token">GitHub token (Gists scope)</label>
      <input type="password" id="set-gist-token" placeholder="paste once, stored locally">

      <label for="set-gist-id">Gist ID (for import on a new device)</label>
      <input type="text" id="set-gist-id" placeholder="paste from another device's export">

      <button class="btn-primary" id="settings-save-btn">Save Settings</button>
      <button class="btn-secondary" id="export-gist-btn">Export to Gist</button>
      <button class="btn-secondary" id="import-gist-btn">Import from Gist</button>
      <div id="gist-status" style="font-size:13px;color:var(--text-dim);margin-top:8px;"></div>
    </div>
  </div>
  <script src="./calc.js"></script>
  <script>
  (function () {
    'use strict';

    var SESSIONS_KEY = 'dashrate_sessions';
    var SETTINGS_KEY = 'dashrate_settings';
    var GIST_TOKEN_KEY = 'dashrate_gist_token';
    var GIST_ID_KEY = 'dashrate_gist_id';

    var DEFAULT_SETTINGS = {
      teslaCostPerMile: 0.045,
      jeepMode: 'calculated',
      jeepMpg: 18,
      gasPrice: 3.50,
      jeepCostPerMileOverride: 0.2,
      worthItThreshold: 18,
      lastVehicle: 'Tesla'
    };

    function getSettings() {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return Object.assign({}, DEFAULT_SETTINGS);
      return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
    }

    function saveSettings(settings) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    function getSessions() {
      var raw = localStorage.getItem(SESSIONS_KEY);
      return raw ? JSON.parse(raw) : [];
    }

    function saveSessions(sessions) {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    }

    // --- TAB NAVIGATION ---
    var tabLogBtn = document.getElementById('tab-log');
    var tabHistoryBtn = document.getElementById('tab-history');
    var logView = document.getElementById('log-view');
    var historyView = document.getElementById('history-view');

    function showTab(name) {
      var isLog = name === 'log';
      logView.classList.toggle('active', isLog);
      historyView.classList.toggle('active', !isLog);
      tabLogBtn.classList.toggle('active', isLog);
      tabHistoryBtn.classList.toggle('active', !isLog);
      if (!isLog) renderHistory();
    }

    tabLogBtn.addEventListener('click', function () { showTab('log'); });
    tabHistoryBtn.addEventListener('click', function () { showTab('history'); });

    // --- SETTINGS SHEET ---
    var settingsBtn = document.getElementById('settings-btn');
    var settingsOverlay = document.getElementById('settings-overlay');

    function fillSettingsForm() {
      var s = getSettings();
      document.getElementById('set-tesla-cost').value = s.teslaCostPerMile;
      document.getElementById('set-jeep-mode').value = s.jeepMode;
      document.getElementById('set-jeep-mpg').value = s.jeepMpg;
      document.getElementById('set-gas-price').value = s.gasPrice;
      document.getElementById('set-jeep-override').value = s.jeepCostPerMileOverride;
      document.getElementById('set-threshold').value = s.worthItThreshold;
      document.getElementById('set-gist-token').value = localStorage.getItem(GIST_TOKEN_KEY) || '';
      document.getElementById('set-gist-id').value = localStorage.getItem(GIST_ID_KEY) || '';
    }

    settingsBtn.addEventListener('click', function () {
      fillSettingsForm();
      settingsOverlay.classList.add('active');
    });

    settingsOverlay.addEventListener('click', function (event) {
      if (event.target === settingsOverlay) settingsOverlay.classList.remove('active');
    });

    document.getElementById('settings-save-btn').addEventListener('click', function () {
      var settings = {
        teslaCostPerMile: parseFloat(document.getElementById('set-tesla-cost').value) || 0,
        jeepMode: document.getElementById('set-jeep-mode').value,
        jeepMpg: parseFloat(document.getElementById('set-jeep-mpg').value) || 0,
        gasPrice: parseFloat(document.getElementById('set-gas-price').value) || 0,
        jeepCostPerMileOverride: parseFloat(document.getElementById('set-jeep-override').value) || 0,
        worthItThreshold: parseFloat(document.getElementById('set-threshold').value) || 0,
        lastVehicle: getSettings().lastVehicle
      };
      saveSettings(settings);
      var token = document.getElementById('set-gist-token').value.trim();
      if (token) localStorage.setItem(GIST_TOKEN_KEY, token);
      var gistId = document.getElementById('set-gist-id').value.trim();
      if (gistId) localStorage.setItem(GIST_ID_KEY, gistId);
      settingsOverlay.classList.remove('active');
    });

    // --- SERVICE WORKER ---
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js');
    }

    function resetLogForm() { /* implemented in Task 6 */ }
    function renderHistory() { /* implemented in Task 7 */ }

    showTab('log');
  })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Manually verify in a browser**

Run: `npx serve public` (or `python3 -m http.server 8080` from inside `public/`)
Open the served URL in a desktop browser. Confirm:
- Page loads with dark background and purple gear icon button.
- Tapping the gear opens the Settings sheet from the bottom with all fields visible.
- Changing a field, tapping "Save Settings", reloading the page, then reopening Settings shows the change persisted.
- Tapping "Log"/"History" tab buttons toggles which section is visible and highlights the active tab in purple.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add app shell, tab navigation, and settings persistence"
```

---

### Task 6: Log tab — entry form, live preview, and save

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `DashRateCalc.computeSession`, `DashRateCalc.computeJeepCostPerMile` (Tasks 1–2); `getSettings`, `saveSettings`, `getSessions`, `saveSessions` (Task 5).
- Produces: `resetLogForm()` (replaces the Task 5 stub), used by Task 9's import flow.

- [ ] **Step 1: Replace the empty log section with the entry form**

Replace:
```html
    <section id="log-view" class="view active"></section>
```
with:
```html
    <section id="log-view" class="view active">
      <div class="card">
        <label for="log-date">Date</label>
        <input type="date" id="log-date">

        <label for="log-vehicle">Vehicle</label>
        <select id="log-vehicle">
          <option value="Tesla">Tesla</option>
          <option value="Jeep">Jeep</option>
        </select>

        <label for="log-start">Start time</label>
        <input type="time" id="log-start">

        <label for="log-end">End time</label>
        <input type="time" id="log-end">

        <label for="log-active">Active minutes</label>
        <input type="number" inputmode="numeric" id="log-active" placeholder="0">

        <label for="log-miles">Miles driven</label>
        <input type="number" step="0.1" inputmode="decimal" id="log-miles" placeholder="0">

        <label for="log-dd-pay">DoorDash pay ($)</label>
        <input type="number" step="0.01" inputmode="decimal" id="log-dd-pay" placeholder="0">

        <label for="log-tips">Tips ($)</label>
        <input type="number" step="0.01" inputmode="decimal" id="log-tips" placeholder="0">
      </div>

      <div class="card" id="log-preview">
        <div class="preview-row"><span class="label">Net pay</span><span id="preview-net">$0.00</span></div>
        <div class="preview-row"><span class="label">$/hr active</span><span id="preview-rate-active">$0.00</span></div>
        <div class="preview-row"><span class="label">$/hr total</span><span id="preview-rate-total">$0.00</span></div>
        <div class="preview-row"><span class="label">Worth it?</span><span id="preview-flag"><span class="flag-dot"></span>&mdash;</span></div>
      </div>

      <button class="btn-primary" id="save-session-btn">Save Session</button>
    </section>
```

- [ ] **Step 2: Replace the `resetLogForm` stub and wire form behavior**

Replace:
```js
    function resetLogForm() { /* implemented in Task 6 */ }
```
with:
```js
    function todayDateString() {
      var d = new Date();
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    function pad2(n) {
      return n < 10 ? '0' + n : '' + n;
    }

    var logDate = document.getElementById('log-date');
    var logVehicle = document.getElementById('log-vehicle');
    var logStart = document.getElementById('log-start');
    var logEnd = document.getElementById('log-end');
    var logActive = document.getElementById('log-active');
    var logMiles = document.getElementById('log-miles');
    var logDdPay = document.getElementById('log-dd-pay');
    var logTips = document.getElementById('log-tips');

    function currentCostPerMile(settings, vehicle) {
      return vehicle === 'Tesla' ? settings.teslaCostPerMile : DashRateCalc.computeJeepCostPerMile(settings);
    }

    function updatePreview() {
      var settings = getSettings();
      var vehicle = logVehicle.value;
      var session = {
        startTime: logStart.value || '00:00',
        endTime: logEnd.value || '00:00',
        activeMinutes: parseFloat(logActive.value) || 0,
        miles: parseFloat(logMiles.value) || 0,
        ddPay: parseFloat(logDdPay.value) || 0,
        tips: parseFloat(logTips.value) || 0,
        costPerMileSnapshot: currentCostPerMile(settings, vehicle),
        thresholdSnapshot: settings.worthItThreshold
      };
      var result = DashRateCalc.computeSession(session);
      document.getElementById('preview-net').textContent = '$' + result.netPay.toFixed(2);
      document.getElementById('preview-rate-active').textContent = '$' + result.rateActive.toFixed(2);
      document.getElementById('preview-rate-total').textContent = '$' + result.rateTotal.toFixed(2);
      var flagEl = document.getElementById('preview-flag');
      flagEl.innerHTML = '<span class="flag-dot flag-' + result.flag + '"></span>' + (result.flag === 'green' ? 'Worth it' : 'Not worth it');
    }

    [logStart, logEnd, logActive, logMiles, logDdPay, logTips, logVehicle].forEach(function (el) {
      el.addEventListener('input', updatePreview);
    });

    function resetLogForm() {
      var settings = getSettings();
      logDate.value = todayDateString();
      logVehicle.value = settings.lastVehicle;
      logStart.value = '';
      logEnd.value = '';
      logActive.value = '';
      logMiles.value = '';
      logDdPay.value = '';
      logTips.value = '';
      updatePreview();
    }

    document.getElementById('save-session-btn').addEventListener('click', function () {
      var settings = getSettings();
      var vehicle = logVehicle.value;
      var session = {
        id: String(Date.now()),
        date: logDate.value || todayDateString(),
        vehicle: vehicle,
        startTime: logStart.value,
        endTime: logEnd.value,
        activeMinutes: parseFloat(logActive.value) || 0,
        miles: parseFloat(logMiles.value) || 0,
        ddPay: parseFloat(logDdPay.value) || 0,
        tips: parseFloat(logTips.value) || 0,
        costPerMileSnapshot: currentCostPerMile(settings, vehicle),
        thresholdSnapshot: settings.worthItThreshold
      };
      var sessions = getSessions();
      sessions.push(session);
      saveSessions(sessions);
      settings.lastVehicle = vehicle;
      saveSettings(settings);
      resetLogForm();
    });
```

- [ ] **Step 3: Replace the final initialization call**

Replace:
```js
    showTab('log');
```
with:
```js
    resetLogForm();
    showTab('log');
```

- [ ] **Step 4: Manually verify in a browser**

Run: `npx serve public`, open the URL. Confirm:
- Date field defaults to today; vehicle defaults to "Tesla" on first run.
- Typing into any numeric/time field live-updates the preview card's net pay, both $/hr values, and flips the flag dot green/red around the $18/hr default threshold.
- Tapping "Save Session" clears the form (date resets to today, vehicle keeps the vehicle just used), and reloading the page shows that same vehicle preselected next time.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: add session entry form with live profitability preview"
```

---

### Task 7: History tab — session list, week switcher, and weekly summary

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `DashRateCalc.computeSession`, `DashRateCalc.getWeekRange`, `DashRateCalc.summarizeSessions` (Tasks 2–3); `getSessions`, `saveSessions` (Task 5).
- Produces: `renderHistory()` (replaces the Task 5 stub) and calls out to `renderBucketBreakdown(sessions)` / `renderDowBreakdown(sessions)`, which Task 8 implements.

- [ ] **Step 1: Replace the empty history section with its markup**

Replace:
```html
    <section id="history-view" class="view"></section>
```
with:
```html
    <section id="history-view" class="view">
      <div class="week-switcher">
        <button id="week-prev">&#9664;</button>
        <div id="week-label">This week</div>
        <button id="week-next">&#9654;</button>
      </div>
      <div class="card" id="weekly-summary"></div>
      <div id="session-list"></div>
      <div class="card">
        <h3>By time of day</h3>
        <table class="breakdown" id="bucket-breakdown"></table>
      </div>
      <div class="card">
        <h3>By day of week</h3>
        <table class="breakdown" id="dow-breakdown"></table>
      </div>
    </section>
```

- [ ] **Step 2: Replace the `renderHistory` stub with the full implementation**

Replace:
```js
    function renderHistory() { /* implemented in Task 7 */ }
```
with:
```js
    var currentWeekAnchor = todayDateString();

    function renderSessionCard(session) {
      var result = DashRateCalc.computeSession(session);
      return '<div class="card session-card ' + result.flag + '">' +
        '<div class="preview-row"><span>' + session.date + ' &middot; ' + session.vehicle + '</span><span>' + session.startTime + '&ndash;' + session.endTime + '</span></div>' +
        '<div class="preview-row"><span class="label">Net</span><span>$' + result.netPay.toFixed(2) + '</span></div>' +
        '<div class="preview-row"><span class="label">$/hr total</span><span>$' + result.rateTotal.toFixed(2) + '</span></div>' +
        '<button class="btn-secondary" data-delete-id="' + session.id + '">Delete</button>' +
        '</div>';
    }

    function renderHistory() {
      var sessions = getSessions().slice().sort(function (a, b) {
        return (b.date + b.startTime).localeCompare(a.date + a.startTime);
      });

      var range = DashRateCalc.getWeekRange(currentWeekAnchor);
      document.getElementById('week-label').textContent = range.start + ' – ' + range.end;

      var weekSessions = sessions.filter(function (s) { return s.date >= range.start && s.date <= range.end; });
      var summary = DashRateCalc.summarizeSessions(weekSessions);
      document.getElementById('weekly-summary').innerHTML =
        '<div class="preview-row"><span class="label">Gross</span><span>$' + summary.totalGross.toFixed(2) + '</span></div>' +
        '<div class="preview-row"><span class="label">Net</span><span>$' + summary.totalNet.toFixed(2) + '</span></div>' +
        '<div class="preview-row"><span class="label">Hours</span><span>' + summary.totalHours.toFixed(1) + '</span></div>' +
        '<div class="preview-row"><span class="label">Blended $/hr</span><span>$' + summary.blendedRate.toFixed(2) + '</span></div>';

      document.getElementById('session-list').innerHTML = sessions.map(renderSessionCard).join('');

      document.querySelectorAll('[data-delete-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-delete-id');
          var remaining = getSessions().filter(function (s) { return s.id !== id; });
          saveSessions(remaining);
          renderHistory();
        });
      });

      renderBucketBreakdown(sessions);
      renderDowBreakdown(sessions);
    }

    function shiftWeek(days) {
      var parts = currentWeekAnchor.split('-').map(Number);
      var d = new Date(parts[0], parts[1] - 1, parts[2] + days);
      currentWeekAnchor = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
      renderHistory();
    }

    document.getElementById('week-prev').addEventListener('click', function () { shiftWeek(-7); });
    document.getElementById('week-next').addEventListener('click', function () { shiftWeek(7); });

    function renderBucketBreakdown(sessions) { /* implemented in Task 8 */ }
    function renderDowBreakdown(sessions) { /* implemented in Task 8 */ }
```

- [ ] **Step 3: Manually verify in a browser**

Run: `npx serve public`, open the URL. Log 2–3 sessions on different dates (some in the current week, at least one a week earlier). Switch to the History tab and confirm:
- Sessions list most-recent-first, each with a green/red left border matching its flag.
- The week label and weekly summary numbers match the current week's sessions only.
- Tapping "&#9664;" moves to the prior week and updates the summary to that week's sessions (or shows zeros if none).
- Deleting a session removes it from the list and updates the summary immediately.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: add history list, week switcher, and weekly summary"
```

---

### Task 8: History tab — time-of-day and day-of-week breakdown tables

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `DashRateCalc.breakdownByBucket`, `DashRateCalc.breakdownByDayOfWeek` (Task 3); called from `renderHistory()` (Task 7).
- Produces: `renderBucketBreakdown(sessions)` and `renderDowBreakdown(sessions)` (replace the Task 7 stubs).

- [ ] **Step 1: Replace the breakdown stubs with the full implementation**

Replace:
```js
    function renderBucketBreakdown(sessions) { /* implemented in Task 8 */ }
    function renderDowBreakdown(sessions) { /* implemented in Task 8 */ }
```
with:
```js
    function renderBreakdownRows(map, order) {
      return order.map(function (key) {
        var value = map[key];
        var display = value === null || value === undefined ? '—' : '$' + value.toFixed(2);
        return '<tr><td>' + key + '</td><td>' + display + '</td></tr>';
      }).join('');
    }

    function renderBucketBreakdown(sessions) {
      var breakdown = DashRateCalc.breakdownByBucket(sessions);
      document.getElementById('bucket-breakdown').innerHTML =
        renderBreakdownRows(breakdown, ['morning', 'afternoon', 'evening']);
    }

    function renderDowBreakdown(sessions) {
      var breakdown = DashRateCalc.breakdownByDayOfWeek(sessions);
      var order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      document.getElementById('dow-breakdown').innerHTML = renderBreakdownRows(breakdown, order);
    }
```

- [ ] **Step 2: Manually verify in a browser**

With the same test sessions from Task 7 (spanning different times of day and days of week), open the History tab and confirm:
- The "By time of day" table shows a dollar average for each bucket that has at least one session, and "&mdash;" for buckets with none.
- The "By day of week" table shows the same pattern per weekday, and the averages match hand-calculated expectations for your test data.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add time-of-day and day-of-week breakdown tables"
```

---

### Task 9: GitHub Gist export/import

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `getSessions`, `getSettings`, `saveSessions`, `saveSettings`, `fillSettingsForm`, `renderHistory`, `resetLogForm` (Tasks 5–7); `GIST_TOKEN_KEY`, `GIST_ID_KEY`, `DEFAULT_SETTINGS` (Task 5).
- Produces: wires the existing `#export-gist-btn` / `#import-gist-btn` buttons from Task 5's markup.

- [ ] **Step 1: Add the Gist functions before the final initialization calls**

Insert, directly above the `resetLogForm(); showTab('log');` lines at the end of the script:

```js
    function requireToken() {
      var token = localStorage.getItem(GIST_TOKEN_KEY);
      if (!token) {
        token = document.getElementById('set-gist-token').value.trim();
        if (token) localStorage.setItem(GIST_TOKEN_KEY, token);
      }
      return token;
    }

    function setGistStatus(message) {
      document.getElementById('gist-status').textContent = message;
    }

    function exportToGist() {
      var token = requireToken();
      if (!token) { setGistStatus('Enter a GitHub token above first.'); return; }
      var payload = { sessions: getSessions(), settings: getSettings() };
      var body = {
        description: 'DashRate data export',
        public: false,
        files: { 'dashrate-data.json': { content: JSON.stringify(payload, null, 2) } }
      };
      var gistId = localStorage.getItem(GIST_ID_KEY);
      var url = gistId ? 'https://api.github.com/gists/' + gistId : 'https://api.github.com/gists';
      var method = gistId ? 'PATCH' : 'POST';
      setGistStatus('Exporting…');
      fetch(url, {
        method: method,
        headers: {
          'Authorization': 'Bearer ' + token,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }).then(function (response) {
        if (!response.ok) throw new Error('GitHub API returned ' + response.status);
        return response.json();
      }).then(function (data) {
        localStorage.setItem(GIST_ID_KEY, data.id);
        document.getElementById('set-gist-id').value = data.id;
        setGistStatus('Exported to Gist ' + data.id + ' at ' + new Date().toLocaleTimeString());
      }).catch(function (error) {
        setGistStatus('Export failed: ' + error.message);
      });
    }

    function importFromGist() {
      var token = requireToken();
      var gistId = localStorage.getItem(GIST_ID_KEY) || document.getElementById('set-gist-id').value.trim();
      if (!token) { setGistStatus('Enter a GitHub token above first.'); return; }
      if (!gistId) { setGistStatus('No Gist ID set — paste the one from your other device above.'); return; }
      localStorage.setItem(GIST_ID_KEY, gistId);
      setGistStatus('Importing…');
      fetch('https://api.github.com/gists/' + gistId, {
        headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' }
      }).then(function (response) {
        if (!response.ok) throw new Error('GitHub API returned ' + response.status);
        return response.json();
      }).then(function (data) {
        var content = data.files['dashrate-data.json'].content;
        var payload = JSON.parse(content);
        saveSessions(payload.sessions || []);
        saveSettings(Object.assign({}, DEFAULT_SETTINGS, payload.settings || {}));
        setGistStatus('Imported ' + (payload.sessions || []).length + ' sessions.');
        fillSettingsForm();
        renderHistory();
        resetLogForm();
      }).catch(function (error) {
        setGistStatus('Import failed: ' + error.message);
      });
    }

    document.getElementById('export-gist-btn').addEventListener('click', exportToGist);
    document.getElementById('import-gist-btn').addEventListener('click', importFromGist);
```

- [ ] **Step 2: Manually verify in a browser using your real GitHub token**

Run: `npx serve public`, open the URL, open Settings, paste your GitHub PAT into "GitHub token", leave Gist ID blank, tap "Export to Gist". Confirm:
- Status line shows "Exported to Gist &lt;id&gt; at &lt;time&gt;" and the Gist ID field auto-fills.
- Visiting `https://gist.github.com` under your account shows a new private gist named "DashRate data export" containing `dashrate-data.json` with your sessions/settings.
- Clear the browser's localStorage for this page (DevTools &rarr; Application &rarr; Local Storage &rarr; Clear), reload, reopen Settings, paste the same token and Gist ID, tap "Import from Gist". Confirm your sessions and settings reappear in the Log/History tabs.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add GitHub Gist export/import"
```

---

### Task 10: Package scripts and GitHub Pages deployment

**Files:**
- Create: `package.json`
- Create: `.gitignore`

**Interfaces:**
- Consumes: the completed `public/` folder from Tasks 1–9.
- Produces: a published GitHub Pages site serving `public/` from a `gh-pages` branch.

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "dashrate",
  "version": "1.0.0",
  "private": true,
  "homepage": "https://mmira11.github.io/dashrate",
  "scripts": {
    "test": "node --test",
    "start": "npx serve public",
    "deploy": "gh-pages -d public"
  },
  "devDependencies": {
    "gh-pages": "^6.1.1"
  }
}
```

- [ ] **Step 3: Install dependencies and run the full test suite**

Run: `npm install`
Run: `npm test`
Expected: PASS (18 tests, unchanged from Task 4 — this is a regression check before deploying)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: add test/deploy scripts and gh-pages dependency"
```

- [ ] **Step 5: Create the GitHub repo and push (requires your explicit go-ahead — this creates a public GitHub repo and pushes code)**

Run:
```bash
gh repo create dashrate --public --source=. --remote=origin --push
```
Expected: repo created at `https://github.com/mmira11/dashrate` (or your actual GitHub username, if different from the Tanda Manager repo's), `main` branch pushed.

- [ ] **Step 6: Deploy to GitHub Pages**

Run: `npm run deploy`
Expected: `gh-pages` pushes the contents of `public/` to a new `gh-pages` branch. If GitHub Pages isn't already enabled for this repo, go to the repo's Settings &rarr; Pages and set the source to the `gh-pages` branch (root).

- [ ] **Step 7: Verify the live site**

Run: `curl -sI https://mmira11.github.io/dashrate/` (adjust for your username)
Expected: `HTTP/2 200`

- [ ] **Step 8: Manually verify the full PWA experience on the Samsung S22+**

On the phone, in Chrome:
- Visit the published URL and confirm the install prompt appears (or use the &vellip; menu &rarr; "Add to Home Screen").
- Open the installed app from the home screen and confirm it launches standalone (no browser chrome).
- Log a real session end-to-end and confirm the preview/flag behave as expected.
- Turn on Airplane Mode, relaunch the app, and confirm it still loads (service worker cache).
- Turn Airplane Mode off, open Settings, paste your GitHub token, and do a real Export/Import round trip.
