# DashRate — Edit Session Design Spec

**Date:** 2026-07-04
**Status:** Approved

## Purpose

Currently, a logged session in the History tab can only be deleted, never corrected. If the user makes a data-entry mistake (wrong miles, wrong time, etc.), they must delete the session and re-enter it from scratch. This spec adds an "Edit" action so a mistake can be fixed in place.

## Approach

Reuse the existing Log tab form for editing, rather than building an inline-editable card or a separate edit modal. The Log form already has all 8 session fields, live preview, and save logic — editing becomes a mode of that same form instead of new UI.

## State

One new piece of state: `editingSessionId` (`null` when the Log form is in "new entry" mode; otherwise the `id` of the session currently being edited).

## Behavior

**Entering edit mode** — Each session card in History gets an "Edit" button alongside the existing "Delete" button. Tapping it:
1. Sets `editingSessionId` to that session's `id`.
2. Fills all 8 Log-tab fields (date, vehicle, start/end time, active minutes, miles, DoorDash pay, tips) from that session's stored values.
3. Switches to the Log tab (`showTab('log')`).
4. Changes the Save button's label from "Save Session" to "Update Session".
5. Reveals a "Cancel" link/button near the form.

**Saving** — The existing save handler branches on `editingSessionId`:
- `null` (today's default behavior, unchanged): push a new session onto the sessions array, snapshot `costPerMileSnapshot`/`thresholdSnapshot` from current Settings, reset the form to blank/new-entry state, stay on the Log tab.
- set (editing): find the session with that `id` in the sessions array and replace its fields in place with the edited values. Re-snapshot `costPerMileSnapshot`/`thresholdSnapshot` from current Settings at save time — same rule as a fresh save, no special-casing for edits. Then clear `editingSessionId`, reset the form to blank/new-entry state, and switch back to the History tab so the corrected card is immediately visible.

**Canceling** — Tapping "Cancel" clears `editingSessionId`, resets the form to blank/new-entry state, restores the Save button's label to "Save Session", hides the Cancel button, and switches back to the History tab. No data is changed.

**Delete** — Unchanged. Stays alongside Edit on each card.

## Data Model

No changes to the session record shape (`id`, `date`, `vehicle`, `startTime`, `endTime`, `activeMinutes`, `miles`, `ddPay`, `tips`, `costPerMileSnapshot`, `thresholdSnapshot`). Editing replaces a session in place by matching `id`; the `id` itself never changes.

## Out of Scope (YAGNI)

- No edit history/audit trail (no record of what a session's values were before an edit).
- No bulk edit of multiple sessions at once.
- No undo for Cancel beyond simply not having saved anything yet.
