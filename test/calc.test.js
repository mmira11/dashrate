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
