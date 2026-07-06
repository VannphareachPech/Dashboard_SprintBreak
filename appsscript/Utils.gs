/**
 * Single source of truth for active-cycle response count.
 * Reads the Form Responses sheet once and counts rows matching the current pulse.
 * Falls back to total row count when no cycle column is present.
 * @param {Spreadsheet} ss
 * @param {Object} settings - result of readSettings()
 * @param {Array} trends - result of getTrends() (may be empty)
 * @return {number} Response count (0 if sheet not found or no data)
 */
function getActiveCycleResponseCount_(ss, settings, trends) {
  var formSheetName = (settings && settings.formSheetName) || PULSE_CONFIG.FORM_RESPONSE_SHEET;
  var sheet = ss.getSheetByName(formSheetName);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  var data = sheet.getDataRange().getValues();
  var headers = data[0] || [];

  var cycleCol = -1;
  for (var c = 0; c < headers.length; c++) {
    var hn = normalizeLabel(headers[c]);
    if (hn === "pulsecycle" || hn === "cycle") { cycleCol = c; break; }
  }

  var activeCycle = "";
  if (trends && trends.length > 0) {
    activeCycle = String(trends[trends.length - 1].cycle || "").trim();
  } else if (settings && settings.currentCycle) {
    activeCycle = safeText_(settings.currentCycle);
  }

  if (cycleCol >= 0 && activeCycle) {
    var count = 0;
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][cycleCol] || "").trim() === activeCycle) count++;
    }
    return count;
  }

  // Fallback: no cycle column — return total data rows (minus header)
  return data.length - 1;
}

function appendTrend(rows, classified, meta) {
	var ss = SpreadsheetApp.getActiveSpreadsheet();
	var sheet = getOrCreateSheet_(ss, PULSE_CONFIG.HISTORY_SHEET);

	var lastRow = sheet.getLastRow();
	var existingRowNumber = null;
	if (lastRow > 1) {
		var existingCycles = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
		for (var ec = 0; ec < existingCycles.length; ec++) {
			if (safeText_(existingCycles[ec][0]) === meta.cycle) {
				existingRowNumber = ec + 2;
				break;
			}
		}
	}

	var areaOrder = (typeof AREA_NAMES !== 'undefined' && AREA_NAMES.length)
		? AREA_NAMES.slice()
		: rows.map(function(r) { return r.area; });

	if (lastRow === 0) {
		sheet.appendRow(['Pulse', 'Overall Score'].concat(areaOrder));
		sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold');
	}

	var scoreMap = {};
	rows.forEach(function(r) {
		scoreMap[r.area] = isFinite(r.score) ? Number(r.score.toFixed(2)) : '';
	});

	var numericScores = rows
		.map(function(r) { return r.score; })
		.filter(function(v) { return isFinite(v); });

	var overallScore = numericScores.length
		? Number((numericScores.reduce(function(sum, n) { return sum + n; }, 0) / numericScores.length).toFixed(2))
		: '';

	var areaScores = areaOrder.map(function(area) {
		return scoreMap[area] !== undefined ? scoreMap[area] : '';
	});

	var rowValues = [meta.cycle, overallScore].concat(areaScores);

	if (existingRowNumber) {
		var existing = sheet.getRange(existingRowNumber, 1, 1, rowValues.length).getValues()[0];
		var hasAreaValues = false;
		for (var c = 2; c < existing.length; c++) {
			if (String(existing[c]).trim() !== '') {
				hasAreaValues = true;
				break;
			}
		}

		if (hasAreaValues) {
			Logger.log('Trend: skipped duplicate row for cycle ' + meta.cycle);
			return;
		}

		sheet.getRange(existingRowNumber, 1, 1, rowValues.length).setValues([rowValues]);
		Logger.log('Trend row updated for cycle: ' + meta.cycle);
		return;
	}

	sheet.appendRow(rowValues);
	Logger.log('Trend row appended for cycle: ' + meta.cycle);
}

function backfillTrendFromFormResponses_(ss) {
	ss = ss || SpreadsheetApp.getActiveSpreadsheet();

	var settings = (typeof readSettings === 'function') ? readSettings() : {};
	var formSheetName = settings.formSheetName || PULSE_CONFIG.FORM_RESPONSE_SHEET;
	var formSheet = ss.getSheetByName(formSheetName);
	if (!formSheet || formSheet.getLastRow() < 2) return;

	var values = formSheet.getDataRange().getValues();
	var headers = values[0];
	var rows = values.slice(1);

	var cycleCol = -1;
	for (var c = 0; c < headers.length; c++) {
		var hc = normalizeLabel(headers[c]);
		if (hc === 'pulsecycle' || hc === 'cycle') {
			cycleCol = c;
			break;
		}
	}
	if (cycleCol < 0) {
		Logger.log('Trend backfill skipped: no Pulse Cycle column found in ' + formSheetName);
		return;
	}

	var areaOrder = (typeof AREA_NAMES !== 'undefined' && AREA_NAMES.length)
		? AREA_NAMES.slice()
		: [];
	if (!areaOrder.length) {
		Logger.log('Trend backfill skipped: AREA_NAMES is empty.');
		return;
	}

	var areaCols = [];
	for (var a = 0; a < areaOrder.length; a++) {
		var area = areaOrder[a];
		var areaNorm = normalizeLabel(area);
		var found = -1;
		for (var i = 0; i < headers.length; i++) {
			var hn = normalizeLabel(headers[i]);
			if (!hn) continue;
			if (hn === areaNorm || hn.indexOf(areaNorm) !== -1) {
				found = i;
				break;
			}
		}
		if (found >= 0) areaCols.push({ area: area, col: found });
	}
	if (!areaCols.length) {
		Logger.log('Trend backfill skipped: no area columns matched in ' + formSheetName);
		return;
	}

	var agg = {};
	for (var r = 0; r < rows.length; r++) {
		var cycle = safeText_(rows[r][cycleCol]);
		if (!cycle) continue;

		if (!agg[cycle]) {
			agg[cycle] = {
				totalSum: 0,
				totalCount: 0,
				area: {},
			};
		}

		for (var ac = 0; ac < areaCols.length; ac++) {
			var areaName = areaCols[ac].area;
			var score = mapPulseValueToScore_(rows[r][areaCols[ac].col]);
			if (score === null) continue;

			if (!agg[cycle].area[areaName]) agg[cycle].area[areaName] = { sum: 0, count: 0 };
			agg[cycle].area[areaName].sum += score;
			agg[cycle].area[areaName].count += 1;
			agg[cycle].totalSum += score;
			agg[cycle].totalCount += 1;
		}
	}

	var trendSheet = getOrCreateSheet_(ss, PULSE_CONFIG.HISTORY_SHEET);
	if (trendSheet.getLastRow() === 0) {
		trendSheet.appendRow(['Pulse', 'Overall Score'].concat(areaOrder));
		trendSheet.getRange(1, 1, 1, trendSheet.getLastColumn()).setFontWeight('bold');
	}

	var trendData = trendSheet.getDataRange().getValues();
	var trendHeaders = trendData[0] || [];
	if (trendHeaders.length < 2) return;

	var areaHeaderIndex = {};
	for (var aoIdx = 0; aoIdx < areaOrder.length; aoIdx++) {
		var areaName = areaOrder[aoIdx];
		var areaNorm = normalizeLabel(areaName);
		for (var th = 2; th < trendHeaders.length; th++) {
			var headerNorm = normalizeLabel(trendHeaders[th]);
			if (!headerNorm) continue;
			if (headerNorm === areaNorm || headerNorm.indexOf(areaNorm) !== -1 || areaNorm.indexOf(headerNorm) !== -1) {
				areaHeaderIndex[areaName] = th;
				break;
			}
		}
	}

	var existingCycleKeys = {};
	for (var tr = 1; tr < trendData.length; tr++) {
		var existingCycle = safeText_(trendData[tr][0]);
		if (existingCycle) existingCycleKeys[normalizeLabel(existingCycle)] = true;
	}

	var appended = 0;
	var cycles = Object.keys(agg);
	for (var ci = 0; ci < cycles.length; ci++) {
		var cycleLabel = cycles[ci];
		if (!cycleLabel) continue;
		if (existingCycleKeys[normalizeLabel(cycleLabel)]) continue;

		var metric = agg[cycleLabel];
		if (!metric.totalCount) continue;

		var rowOut = new Array(trendHeaders.length);
		for (var fill = 0; fill < rowOut.length; fill++) rowOut[fill] = '';
		rowOut[0] = cycleLabel;
		rowOut[1] = Number((metric.totalSum / metric.totalCount).toFixed(2));

		for (var ao = 0; ao < areaOrder.length; ao++) {
			var areaName = areaOrder[ao];
			var idx = areaHeaderIndex[areaName];
			if (idx === undefined) continue;
			var areaStat = metric.area[areaName];
			if (areaStat && areaStat.count > 0) {
				rowOut[idx] = Number((areaStat.sum / areaStat.count).toFixed(2));
			}
		}

		trendSheet.appendRow(rowOut);
		existingCycleKeys[normalizeLabel(cycleLabel)] = true;
		appended++;
	}

	if (appended > 0) {
		sortTrendSheetByCycle_(trendSheet);
		Logger.log('Trend backfill: appended ' + appended + ' historical cycle(s) from ' + formSheetName + '.');
	}
}

function sortTrendSheetByCycle_(sheet) {
	var lastRow = sheet.getLastRow();
	var lastCol = sheet.getLastColumn();
	if (lastRow <= 2 || lastCol < 2) return;

	var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
	data.sort(function(a, b) {
		var ac = safeText_(a[0]);
		var bc = safeText_(b[0]);

		var an = parseInt(ac.replace(/[^0-9]/g, ''), 10);
		var bn = parseInt(bc.replace(/[^0-9]/g, ''), 10);
		if (!isNaN(an) && !isNaN(bn) && an !== bn) return an - bn;

		return ac.localeCompare(bc);
	});

	sheet.getRange(2, 1, data.length, lastCol).setValues(data);
}