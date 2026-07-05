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

  function computeSession(session) {
    var totalLoggedMinutes = computeLoggedMinutes(session.startTime, session.endTime);
    var grossPay = session.ddPay + session.tips;
    var energyCost = session.miles * session.costPerMileSnapshot;
    var netPay = grossPay - energyCost;
    var rateActive = session.activeMinutes > 0 ? netPay / (session.activeMinutes / 60) : 0;
    var rateTotal = totalLoggedMinutes > 0 ? netPay / (totalLoggedMinutes / 60) : 0;
    var ratePerMile = session.miles > 0 ? netPay / session.miles : 0;
    var flag = rateTotal >= session.thresholdSnapshot ? 'green' : 'red';
    return {
      totalLoggedMinutes: totalLoggedMinutes,
      grossPay: grossPay,
      energyCost: energyCost,
      netPay: netPay,
      rateActive: rateActive,
      rateTotal: rateTotal,
      ratePerMile: ratePerMile,
      flag: flag
    };
  }

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

  function breakdownByVehicle(sessions) {
    var groups = { Tesla: [], Jeep: [] };
    sessions.forEach(function (s) { groups[s.vehicle].push(s); });
    return {
      Tesla: averageRateTotal(groups.Tesla),
      Jeep: averageRateTotal(groups.Jeep)
    };
  }

  function breakdownByDate(sessions) {
    var groups = {};
    sessions.forEach(function (s) {
      if (!groups[s.date]) groups[s.date] = { date: s.date, net: 0, hours: 0, sessionCount: 0 };
      var c = computeSession(s);
      groups[s.date].net += c.netPay;
      groups[s.date].hours += c.totalLoggedMinutes / 60;
      groups[s.date].sessionCount += 1;
    });
    return Object.keys(groups).sort().map(function (date) { return groups[date]; });
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
    breakdownByDate: breakdownByDate,
    weeklyTrend: weeklyTrend
  };
});
