# DashRate Analytics Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third "Analytics" tab with three glanceable bar charts (day-of-week, 8-week trend, Tesla-vs-Jeep) so the user can see where they stand at a glance, without reading tables.

**Architecture:** Two new pure, unit-tested aggregation functions in `public/calc.js` (`weeklyTrend`, `breakdownByVehicle`), consistent with the existing `breakdownByBucket`/`breakdownByDayOfWeek` pattern. `public/index.html` gets a third tab/view, a shared `renderBarChart(containerId, items)` SVG-free (pure `<div>`/CSS bar) renderer, and three thin per-chart functions that compute data and call the shared renderer.

**Tech Stack:** Vanilla HTML/CSS/JS (unchanged). Bars are plain `<div>` elements sized via CSS `height` percentage — no inline SVG needed for simple bar charts, no external dependencies, consistent with the rest of the app.

## Global Constraints

- No external dependencies — hand-rolled bars via CSS, no charting library.
- Every bar's color reflects the SAME green/red profitability-flag meaning used elsewhere: green if its value meets `settings.worthItThreshold` (checked at render time, current settings — not a stored snapshot), red otherwise. A bar with no underlying data is neutral gray, never green or red.
- Electric purple stays reserved for UI controls; it is never used to encode chart data.
- Weekly trend covers exactly the last 8 calendar weeks (fixed, not configurable), oldest-to-newest left to right.
- The existing 21 automated tests (`test/calc.test.js`, `test/manifest.test.js`) must keep passing; new calc.js functions get their own tests in the same file, following the existing test style (concrete numeric expectations derived independently, not by calling the function under test on itself).

---

### Task 1: `weeklyTrend` and `breakdownByVehicle` in `calc.js` (TDD)

**Files:**
- Modify: `public/calc.js` (append two new functions; add to the exported object)
- Modify: `test/calc.test.js` (append tests)

**Interfaces:**
- Consumes: `getWeekRange(dateStr)`, `summarizeSessions(sessions)`, `computeSession(session)`, `averageRateTotal(sessions)` — all already defined in `public/calc.js`.
- Produces: `DashRateCalc.weeklyTrend(sessions, weekCount, anchorDate) -> Array<{ weekStart, weekEnd, blendedRate, hasData }>` (oldest-to-newest, exactly `weekCount` entries) and `DashRateCalc.breakdownByVehicle(sessions) -> { Tesla: number|null, Jeep: number|null }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/calc.test.js`:

```js
test('breakdownByVehicle averages rateTotal per vehicle and returns null for a vehicle with no sessions', () => {
  const { computeSession, breakdownByVehicle } = require('../public/calc.js');
  const teslaSession = { vehicle: 'Tesla', startTime: '08:00', endTime: '09:00', activeMinutes: 60, miles: 5, ddPay: 20, tips: 5, costPerMileSnapshot: 0.045, thresholdSnapshot: 18, date: '2026-06-29' };
  const tesla = computeSession(teslaSession);
  const result = breakdownByVehicle([teslaSession]);
  assert.equal(result.Tesla, tesla.rateTotal);
  assert.equal(result.Jeep, null);
});

test('breakdownByVehicle averages across multiple sessions of the same vehicle', () => {
  const { computeSession, breakdownByVehicle } = require('../public/calc.js');
  const jeepSession1 = { vehicle: 'Jeep', startTime: '08:00', endTime: '09:00', activeMinutes: 60, miles: 5, ddPay: 20, tips: 5, costPerMileSnapshot: 0.18, thresholdSnapshot: 18, date: '2026-06-29' };
  const jeepSession2 = { vehicle: 'Jeep', startTime: '10:00', endTime: '12:00', activeMinutes: 90, miles: 20, ddPay: 25, tips: 10, costPerMileSnapshot: 0.18, thresholdSnapshot: 18, date: '2026-06-30' };
  const a = computeSession(jeepSession1);
  const b = computeSession(jeepSession2);
  const result = breakdownByVehicle([jeepSession1, jeepSession2]);
  assert.equal(result.Jeep, (a.rateTotal + b.rateTotal) / 2);
  assert.equal(result.Tesla, null);
});

test('weeklyTrend returns weekCount weeks ordered oldest-to-newest, anchored on the given date', () => {
  const { weeklyTrend } = require('../public/calc.js');
  const result = weeklyTrend([], 2, '2026-07-03');
  assert.deepEqual(result, [
    { weekStart: '2026-06-22', weekEnd: '2026-06-28', blendedRate: 0, hasData: false },
    { weekStart: '2026-06-29', weekEnd: '2026-07-05', blendedRate: 0, hasData: false }
  ]);
});

test('weeklyTrend reports hasData and the correct blended rate for weeks with sessions', () => {
  const { summarizeSessions, weeklyTrend } = require('../public/calc.js');
  const olderWeekSession = { vehicle: 'Tesla', startTime: '08:00', endTime: '09:00', activeMinutes: 60, miles: 5, ddPay: 20, tips: 5, costPerMileSnapshot: 0.045, thresholdSnapshot: 18, date: '2026-06-23' };
  const newerWeekSession = { vehicle: 'Tesla', startTime: '08:00', endTime: '10:00', activeMinutes: 90, miles: 10, ddPay: 25, tips: 10, costPerMileSnapshot: 0.045, thresholdSnapshot: 18, date: '2026-06-30' };
  const olderSummary = summarizeSessions([olderWeekSession]);
  const newerSummary = summarizeSessions([newerWeekSession]);
  const result = weeklyTrend([olderWeekSession, newerWeekSession], 2, '2026-07-03');
  assert.equal(result[0].weekStart, '2026-06-22');
  assert.equal(result[0].hasData, true);
  assert.equal(result[0].blendedRate, olderSummary.blendedRate);
  assert.equal(result[1].weekStart, '2026-06-29');
  assert.equal(result[1].hasData, true);
  assert.equal(result[1].blendedRate, newerSummary.blendedRate);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test`
Expected: FAIL — `breakdownByVehicle is not a function` (and similarly for `weeklyTrend`)

- [ ] **Step 3: Add the two functions to `public/calc.js`**

Replace the final `return { ... }` block with:

```js
  function breakdownByVehicle(sessions) {
    var groups = { Tesla: [], Jeep: [] };
    sessions.forEach(function (s) { groups[s.vehicle].push(s); });
    return {
      Tesla: averageRateTotal(groups.Tesla),
      Jeep: averageRateTotal(groups.Jeep)
    };
  }

  function weeklyTrend(sessions, weekCount, anchorDate) {
    var weeks = [];
    var cursor = anchorDate;
    for (var i = 0; i < weekCount; i++) {
      weeks.unshift(getWeekRange(cursor));
      var parts = parseDateParts(cursor);
      var d = new Date(parts.year, parts.month - 1, parts.day - 7);
      cursor = formatDate(d);
    }
    return weeks.map(function (range) {
      var weekSessions = sessions.filter(function (s) { return s.date >= range.start && s.date <= range.end; });
      var summary = summarizeSessions(weekSessions);
      return {
        weekStart: range.start,
        weekEnd: range.end,
        blendedRate: summary.blendedRate,
        hasData: weekSessions.length > 0
      };
    });
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
    breakdownByDayOfWeek: breakdownByDayOfWeek,
    breakdownByVehicle: breakdownByVehicle,
    weeklyTrend: weeklyTrend
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS (25 tests — 21 existing + 4 new)

- [ ] **Step 5: Commit**

```bash
git add public/calc.js test/calc.test.js
git commit -m "feat: add weekly-trend and per-vehicle breakdown calculations"
```

---

### Task 2: Analytics tab UI — third tab, shared bar-chart renderer, three charts

**Files:**
- Modify: `public/index.html:96-97` (add bar-chart CSS after the existing `table.breakdown` rules)
- Modify: `public/index.html:161-165` (add the `analytics-view` section and the `tab-analytics` button)
- Modify: `public/index.html:243-258` (extend `showTab`/tab wiring from two tabs to three)
- Modify: `public/index.html:593-595` (add `renderAnalytics()` alongside `renderHistory()` in `importFromGist`'s success handler, so Analytics doesn't show stale data after a Gist import)
- Modify: `public/index.html:526` area (add `renderBarChart`, `renderAnalytics`, `renderDowChart`, `renderTrendChart`, `renderVehicleChart` — insert directly after the existing `renderDowBreakdown` function)

**Interfaces:**
- Consumes: `DashRateCalc.breakdownByDayOfWeek`, `DashRateCalc.breakdownByVehicle`, `DashRateCalc.weeklyTrend` (Task 1 + existing); `getSessions()`, `getSettings()`, `todayDateString()` (existing).
- Produces: `renderBarChart(containerId, items)`, `renderAnalytics()`, `renderDowChart(sessions)`, `renderTrendChart(sessions)`, `renderVehicleChart(sessions)`. Called by `showTab('analytics')` and by `importFromGist`'s success path.

- [ ] **Step 1: Add the bar-chart CSS**

Replace:
```css
  table.breakdown { width: 100%; border-collapse: collapse; margin-top: 8px; }
  table.breakdown td { padding: 8px 4px; font-size: 14px; border-bottom: 1px solid #23283a; }
  table.breakdown td:last-child { text-align: right; }
</style>
```
with:
```css
  table.breakdown { width: 100%; border-collapse: collapse; margin-top: 8px; }
  table.breakdown td { padding: 8px 4px; font-size: 14px; border-bottom: 1px solid #23283a; }
  table.breakdown td:last-child { text-align: right; }
  .bar-chart { display: flex; align-items: flex-end; gap: 8px; height: 140px; padding: 12px 4px 0; }
  .bar-chart .bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
  .bar-chart .bar { width: 100%; max-width: 32px; border-radius: 6px 6px 0 0; background: #3a3f4d; }
  .bar-chart .bar.green { background: var(--green); }
  .bar-chart .bar.red { background: var(--red); }
  .bar-chart .bar-value { font-size: 11px; color: var(--text-dim); margin-bottom: 4px; }
  .bar-chart .bar-label { font-size: 11px; color: var(--text-dim); margin-top: 6px; text-align: center; }
</style>
```

- [ ] **Step 2: Add the Analytics view section and tab button**

Replace:
```html
    </section>
  </main>
  <nav class="tabbar">
    <button id="tab-log" class="active">Log</button>
    <button id="tab-history">History</button>
```
with:
```html
    </section>
    <section id="analytics-view" class="view">
      <div class="card">
        <h3>By day of week</h3>
        <div class="bar-chart" id="chart-dow"></div>
      </div>
      <div class="card">
        <h3>Weekly trend</h3>
        <div class="bar-chart" id="chart-trend"></div>
      </div>
      <div class="card">
        <h3>Tesla vs Jeep</h3>
        <div class="bar-chart" id="chart-vehicle"></div>
      </div>
    </section>
  </main>
  <nav class="tabbar">
    <button id="tab-log" class="active">Log</button>
    <button id="tab-history">History</button>
    <button id="tab-analytics">Analytics</button>
```

- [ ] **Step 3: Extend `showTab` and tab wiring to three tabs**

Replace:
```js
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
```
with:
```js
    var tabLogBtn = document.getElementById('tab-log');
    var tabHistoryBtn = document.getElementById('tab-history');
    var tabAnalyticsBtn = document.getElementById('tab-analytics');
    var logView = document.getElementById('log-view');
    var historyView = document.getElementById('history-view');
    var analyticsView = document.getElementById('analytics-view');

    function showTab(name) {
      logView.classList.toggle('active', name === 'log');
      historyView.classList.toggle('active', name === 'history');
      analyticsView.classList.toggle('active', name === 'analytics');
      tabLogBtn.classList.toggle('active', name === 'log');
      tabHistoryBtn.classList.toggle('active', name === 'history');
      tabAnalyticsBtn.classList.toggle('active', name === 'analytics');
      if (name === 'history') renderHistory();
      if (name === 'analytics') renderAnalytics();
    }

    tabLogBtn.addEventListener('click', function () { showTab('log'); });
    tabHistoryBtn.addEventListener('click', function () { showTab('history'); });
    tabAnalyticsBtn.addEventListener('click', function () { showTab('analytics'); });
```

- [ ] **Step 4: Add the chart rendering functions**

Replace:
```js
    function renderDowBreakdown(sessions) {
      var breakdown = DashRateCalc.breakdownByDayOfWeek(sessions);
      var order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      document.getElementById('dow-breakdown').innerHTML = renderBreakdownRows(breakdown, order);
    }
```
with:
```js
    function renderDowBreakdown(sessions) {
      var breakdown = DashRateCalc.breakdownByDayOfWeek(sessions);
      var order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      document.getElementById('dow-breakdown').innerHTML = renderBreakdownRows(breakdown, order);
    }

    function renderBarChart(containerId, items) {
      var threshold = getSettings().worthItThreshold;
      var maxValue = items.reduce(function (max, item) {
        return item.hasData && item.value > max ? item.value : max;
      }, 0);
      var html = items.map(function (item) {
        var heightPct = item.hasData && maxValue > 0 ? Math.max(4, (item.value / maxValue) * 100) : 4;
        var barClass = !item.hasData ? '' : (item.value >= threshold ? 'green' : 'red');
        var valueLabel = item.hasData ? '$' + item.value.toFixed(2) : '—';
        return '<div class="bar-col">' +
          '<div class="bar-value">' + valueLabel + '</div>' +
          '<div class="bar ' + barClass + '" style="height:' + heightPct + '%"></div>' +
          '<div class="bar-label">' + item.label + '</div>' +
          '</div>';
      }).join('');
      document.getElementById(containerId).innerHTML = html;
    }

    function renderDowChart(sessions) {
      var breakdown = DashRateCalc.breakdownByDayOfWeek(sessions);
      var order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      var items = order.map(function (day) {
        var value = breakdown[day];
        return { label: day.slice(0, 3), value: value === null ? 0 : value, hasData: value !== null };
      });
      renderBarChart('chart-dow', items);
    }

    function renderTrendChart(sessions) {
      var trend = DashRateCalc.weeklyTrend(sessions, 8, todayDateString());
      var items = trend.map(function (week) {
        return { label: week.weekStart.slice(5), value: week.blendedRate, hasData: week.hasData };
      });
      renderBarChart('chart-trend', items);
    }

    function renderVehicleChart(sessions) {
      var breakdown = DashRateCalc.breakdownByVehicle(sessions);
      var items = ['Tesla', 'Jeep'].map(function (vehicle) {
        var value = breakdown[vehicle];
        return { label: vehicle, value: value === null ? 0 : value, hasData: value !== null };
      });
      renderBarChart('chart-vehicle', items);
    }

    function renderAnalytics() {
      var sessions = getSessions();
      renderDowChart(sessions);
      renderTrendChart(sessions);
      renderVehicleChart(sessions);
    }
```

- [ ] **Step 5: Refresh Analytics after a Gist import**

Replace:
```js
        fillSettingsForm();
        renderHistory();
        resetLogForm();
        stopEditingSession();
```
with:
```js
        fillSettingsForm();
        renderHistory();
        renderAnalytics();
        resetLogForm();
        stopEditingSession();
```

- [ ] **Step 6: Run the existing test suite to confirm no regression**

Run: `node --test`
Expected: PASS (25 tests, unchanged from Task 1 — this task only touches `index.html`)

- [ ] **Step 7: Manually verify in a browser**

Run: `npx serve public` (or `python3 -m http.server 8080` from inside `public/`), open the served URL.
1. Log several test sessions across at least two different weeks, at least two different days of the week, and both vehicles, with a mix of good and bad `$/hr` relative to your worth-it threshold.
2. Tap the new "Analytics" tab. Confirm three charts render: day-of-week, an 8-week trend (most weeks likely empty/gray except the ones you logged into), and Tesla vs Jeep.
3. Confirm bars are green when that bar's value is ≥ your threshold, red when below, and neutral gray for a day/week/vehicle with no data at all (not green or red).
4. Change your worth-it threshold in Settings, save, and revisit Analytics — confirm bar colors update to reflect the new threshold (they're computed at render time, not cached).
5. Confirm the Log and History tabs still work exactly as before, and that switching between all three tabs re-renders the right content each time.

- [ ] **Step 8: Commit**

```bash
git add public/index.html
git commit -m "feat: add Analytics tab with day-of-week, weekly trend, and vehicle comparison charts"
```
