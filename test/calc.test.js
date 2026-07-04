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
