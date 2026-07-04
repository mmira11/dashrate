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

test('computeSession computes gross, energy cost, net pay, and both rates for a same-day session', () => {
  const { computeSession } = require('../public/calc.js');
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

test('breakdownByBucket averages rateTotal across multiple sessions in the same bucket', () => {
  const { computeSession, breakdownByBucket } = require('../public/calc.js');
  const morningSession1 = { startTime: '08:00', endTime: '09:00', activeMinutes: 60, miles: 5, ddPay: 20, tips: 5, costPerMileSnapshot: 0.045, thresholdSnapshot: 18, date: '2026-06-29' };
  const morningSession2 = { startTime: '10:00', endTime: '12:00', activeMinutes: 90, miles: 20, ddPay: 25, tips: 10, costPerMileSnapshot: 0.045, thresholdSnapshot: 18, date: '2026-06-29' };
  const morning1 = computeSession(morningSession1);
  const morning2 = computeSession(morningSession2);
  const expectedAverage = (morning1.rateTotal + morning2.rateTotal) / 2;
  const result = breakdownByBucket([morningSession1, morningSession2]);
  assert.equal(result.morning, expectedAverage);
  assert.equal(result.afternoon, null);
  assert.equal(result.evening, null);
});

test('breakdownByDayOfWeek averages rateTotal across multiple sessions on the same weekday', () => {
  const { computeSession, breakdownByDayOfWeek } = require('../public/calc.js');
  const mondaySession1 = { startTime: '08:00', endTime: '09:00', activeMinutes: 60, miles: 5, ddPay: 20, tips: 5, costPerMileSnapshot: 0.045, thresholdSnapshot: 18, date: '2026-06-29' };
  const mondaySession2 = { startTime: '10:00', endTime: '12:00', activeMinutes: 90, miles: 20, ddPay: 25, tips: 10, costPerMileSnapshot: 0.045, thresholdSnapshot: 18, date: '2026-06-29' };
  const monday1 = computeSession(mondaySession1);
  const monday2 = computeSession(mondaySession2);
  const expectedAverage = (monday1.rateTotal + monday2.rateTotal) / 2;
  const result = breakdownByDayOfWeek([mondaySession1, mondaySession2]);
  assert.equal(result.Monday, expectedAverage);
  assert.equal(result.Tuesday, null);
  assert.equal(result.Sunday, null);
});

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
