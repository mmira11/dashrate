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
