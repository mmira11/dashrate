# DashRate Edit Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged session be corrected in place from the History tab, instead of only deleting and re-entering it.

**Architecture:** Reuse the existing Log tab form as the edit surface. A single new state flag, `editingSessionId`, tells the existing save handler whether to push a new session or replace an existing one by `id`. No new files, no new storage keys — all changes are inside `public/index.html`.

**Tech Stack:** Vanilla HTML/CSS/JS (unchanged from the rest of the project). No automated tests for this file (not unit-testable with `node:test`); verification is manual/browser-based, consistent with how the original Log/History tasks were verified.

## Global Constraints

- No new files — every change lives in `public/index.html`.
- Editing must reuse the existing Log form fields, `updatePreview()`, and `resetLogForm()` — do not duplicate form markup or preview logic.
- On save while editing, re-snapshot `costPerMileSnapshot`/`thresholdSnapshot` from current Settings — same rule as a brand-new session, no special-casing.
- The session's `id` must never change during an edit; only its other fields are replaced.
- Canceling an edit must not modify `localStorage` in any way.
- Delete behavior is unchanged.
- The existing 21 tests in `test/calc.test.js`/`test/manifest.test.js` must continue to pass (this feature doesn't touch `public/calc.js`, so this is a pure regression check).

---

### Task 1: Add Edit button, edit-mode state, and Cancel flow

**Files:**
- Modify: `public/index.html:142-143` (add Cancel button after Save button)
- Modify: `public/index.html:354-389` (add `editingSessionId` state, `fillFormFromSession`, `startEditingSession`, `stopEditingSession`, and rewrite the save-button handler to branch on edit mode; add the Cancel button's click handler)
- Modify: `public/index.html:399-407` (`renderSessionCard`: add an Edit button alongside Delete)
- Modify: `public/index.html:427-434` (`renderHistory`: wire up the new `[data-edit-id]` buttons)

**Interfaces:**
- Consumes: `getSessions()`, `saveSessions(sessions)`, `getSettings()`, `saveSettings(settings)`, `currentCostPerMile(settings, vehicle)`, `updatePreview()`, `resetLogForm()`, `showTab(name)`, `renderHistory()` — all already defined elsewhere in `public/index.html`.
- Produces: `editingSessionId` (module-level variable, `null` or a session `id` string), `fillFormFromSession(session)`, `startEditingSession(id)`, `stopEditingSession()`. No later task depends on these (this is the only task), but they must not collide with any existing identifier in the file (confirmed: none of these four names exist yet).

- [ ] **Step 1: Add the Cancel button next to Save in the Log form markup**

Replace:
```html
      <button class="btn-primary" id="save-session-btn">Save Session</button>
    </section>
```
with:
```html
      <button class="btn-primary" id="save-session-btn">Save Session</button>
      <button class="btn-secondary" id="cancel-edit-btn" style="display:none;">Cancel</button>
    </section>
```

- [ ] **Step 2: Add edit-mode state and rewrite the save handler**

Replace the entire block from `function resetLogForm() {` through the closing `});` of the existing save-button handler:
```js
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
        startTime: logStart.value || '00:00',
        endTime: logEnd.value || '00:00',
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
with:
```js
    var editingSessionId = null;

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

    function fillFormFromSession(session) {
      logDate.value = session.date;
      logVehicle.value = session.vehicle;
      logStart.value = session.startTime;
      logEnd.value = session.endTime;
      logActive.value = session.activeMinutes;
      logMiles.value = session.miles;
      logDdPay.value = session.ddPay;
      logTips.value = session.tips;
      updatePreview();
    }

    function startEditingSession(id) {
      var match = getSessions().filter(function (s) { return s.id === id; });
      if (!match.length) return;
      editingSessionId = id;
      fillFormFromSession(match[0]);
      document.getElementById('save-session-btn').textContent = 'Update Session';
      document.getElementById('cancel-edit-btn').style.display = 'block';
      showTab('log');
    }

    function stopEditingSession() {
      editingSessionId = null;
      document.getElementById('save-session-btn').textContent = 'Save Session';
      document.getElementById('cancel-edit-btn').style.display = 'none';
    }

    document.getElementById('save-session-btn').addEventListener('click', function () {
      var settings = getSettings();
      var vehicle = logVehicle.value;
      var sessionData = {
        date: logDate.value || todayDateString(),
        vehicle: vehicle,
        startTime: logStart.value || '00:00',
        endTime: logEnd.value || '00:00',
        activeMinutes: parseFloat(logActive.value) || 0,
        miles: parseFloat(logMiles.value) || 0,
        ddPay: parseFloat(logDdPay.value) || 0,
        tips: parseFloat(logTips.value) || 0,
        costPerMileSnapshot: currentCostPerMile(settings, vehicle),
        thresholdSnapshot: settings.worthItThreshold
      };
      settings.lastVehicle = vehicle;
      saveSettings(settings);

      var sessions = getSessions();
      if (editingSessionId) {
        var editedId = editingSessionId;
        sessions = sessions.map(function (s) {
          if (s.id !== editedId) return s;
          sessionData.id = s.id;
          return sessionData;
        });
        saveSessions(sessions);
        stopEditingSession();
        resetLogForm();
        showTab('history');
      } else {
        sessionData.id = String(Date.now());
        sessions.push(sessionData);
        saveSessions(sessions);
        resetLogForm();
      }
    });

    document.getElementById('cancel-edit-btn').addEventListener('click', function () {
      stopEditingSession();
      resetLogForm();
      showTab('history');
    });
```

- [ ] **Step 3: Add the Edit button to each session card**

Replace:
```js
    function renderSessionCard(session) {
      var result = DashRateCalc.computeSession(session);
      return '<div class="card session-card ' + result.flag + '">' +
        '<div class="preview-row"><span>' + session.date + ' &middot; ' + session.vehicle + '</span><span>' + session.startTime + '&ndash;' + session.endTime + '</span></div>' +
        '<div class="preview-row"><span class="label">Net</span><span>$' + result.netPay.toFixed(2) + '</span></div>' +
        '<div class="preview-row"><span class="label">$/hr total</span><span>$' + result.rateTotal.toFixed(2) + '</span></div>' +
        '<button class="btn-secondary" data-delete-id="' + session.id + '">Delete</button>' +
        '</div>';
    }
```
with:
```js
    function renderSessionCard(session) {
      var result = DashRateCalc.computeSession(session);
      return '<div class="card session-card ' + result.flag + '">' +
        '<div class="preview-row"><span>' + session.date + ' &middot; ' + session.vehicle + '</span><span>' + session.startTime + '&ndash;' + session.endTime + '</span></div>' +
        '<div class="preview-row"><span class="label">Net</span><span>$' + result.netPay.toFixed(2) + '</span></div>' +
        '<div class="preview-row"><span class="label">$/hr total</span><span>$' + result.rateTotal.toFixed(2) + '</span></div>' +
        '<button class="btn-secondary" data-edit-id="' + session.id + '">Edit</button>' +
        '<button class="btn-secondary" data-delete-id="' + session.id + '">Delete</button>' +
        '</div>';
    }
```

- [ ] **Step 4: Wire up the Edit buttons in `renderHistory`**

Replace:
```js
      document.querySelectorAll('[data-delete-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-delete-id');
          var remaining = getSessions().filter(function (s) { return s.id !== id; });
          saveSessions(remaining);
          renderHistory();
        });
      });
```
with:
```js
      document.querySelectorAll('[data-edit-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          startEditingSession(btn.getAttribute('data-edit-id'));
        });
      });

      document.querySelectorAll('[data-delete-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-delete-id');
          var remaining = getSessions().filter(function (s) { return s.id !== id; });
          saveSessions(remaining);
          renderHistory();
        });
      });
```

- [ ] **Step 5: Run the existing test suite to confirm no regression**

Run: `node --test`
Expected: PASS (21 tests — this feature doesn't touch `calc.js`, so the count and results should be identical to before this change)

- [ ] **Step 6: Manually verify in a browser**

Run: `npx serve public` (or `python3 -m http.server 8080` from inside `public/`), open the served URL.
1. Log two or three test sessions from the Log tab as usual.
2. Switch to History. Confirm each card now shows both "Edit" and "Delete" buttons.
3. Tap "Edit" on one card. Confirm: you're switched to the Log tab, all 8 fields are pre-filled with that session's exact values, the button now reads "Update Session", and a "Cancel" button is visible.
4. Change one field (e.g. fix the miles) and tap "Update Session". Confirm: you're switched back to History, the edited card now shows the corrected value, and its `$/hr` figures reflect the change. Confirm no duplicate card was created (still the same total count of sessions).
5. Tap "Edit" on a card again, then tap "Cancel" without changing anything. Confirm: you're switched back to History, the card is unchanged, and no new/duplicate session appears.
6. Log a brand-new session (not via Edit) after doing the above. Confirm the ordinary "Save Session" flow still works exactly as before (stays on Log tab, form resets, vehicle defaults to last used).
7. Confirm Delete still works unchanged on a non-edited card.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: allow editing a logged session instead of only deleting it"
```
