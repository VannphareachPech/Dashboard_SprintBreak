function readScoreRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getRequiredSheet_(ss, PULSE_CONFIG.SUMMARY_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow < PULSE_CONFIG.SCORE_DATA_START_ROW) return [];

  const rowCount = lastRow - PULSE_CONFIG.SCORE_DATA_START_ROW + 1;
  const values = sheet
    .getRange(PULSE_CONFIG.SCORE_DATA_START_ROW, PULSE_CONFIG.AREA_COL, rowCount, PULSE_CONFIG.STATUS_COL)
    .getDisplayValues();

  // Only keep rows whose area name is a canonical survey area — this prevents
  // metadata rows ("Lowest Area", "Total Responses", etc.) from polluting the
  // Slack message, AI prompt, and Leadership Summary tab.
  var validAreas = (typeof AREA_NAMES !== "undefined" && AREA_NAMES.length) ? AREA_NAMES : null;

  return values
    .map(function(row) {
      const area = safeText_(row[0]);
      const score = parseScore_(row[1]);
      const status = normalizeStatus_(row[2]) || inferStatusFromScore_(score);
      return { area: area, score: score, status: status };
    })
    .filter(function(item) {
      if (!item.area) return false;
      if (validAreas) return validAreas.indexOf(item.area) !== -1;
      return true;
    });
}

function readKeyMetrics() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getRequiredSheet_(ss, PULSE_CONFIG.SUMMARY_SHEET);
  const values = sheet.getDataRange().getDisplayValues();
  const result = { lowestArea: "", highestArea: "", totalResponses: 0 };

  const labelMap = {
    lowestArea:     ["lowest scoring area", "lowest area"],
    highestArea:    ["highest scoring area", "highest area"],
    totalResponses: ["total responses", "response count", "total reponses"]
  };

  Object.keys(labelMap).forEach(function(key) {
    const variants = labelMap[key];
    for (var r = 0; r < values.length; r++) {
      for (var c = 0; c < values[r].length; c++) {
        if (variants.indexOf(normalizeText_(values[r][c])) > -1 && c + 1 < values[r].length) {
          result[key] = safeText_(values[r][c + 1]);
          return;
        }
      }
    }
  });

  // Re-derive totalResponses for the active cycle only (centralized helper).
  const settings = readSettings();
  const trends = typeof getTrends === "function" ? getTrends(ss) : [];
  const cycleCount = getActiveCycleResponseCount_(ss, settings, trends);
  if (cycleCount > 0) result.totalResponses = String(cycleCount);

  return result;
}

function classifyRows(rows) {
  const positive = [], mixed = [], concern = [];
  rows.forEach(function(row) {
    const label = row.area + " (" + (isFinite(row.score) ? row.score.toFixed(2) : "n/a") + ")";
    if (row.status === "Concern") concern.push(label);
    else if (row.status === "Mixed") mixed.push(label);
    else positive.push(label);
  });
  return { positiveAreas: positive, mixedAreas: mixed, concernAreas: concern };
}

function readOpenTextResponses() {
  const settings = readSettings();
  const sheetName = settings.formSheetName || PULSE_CONFIG.FORM_RESPONSE_SHEET;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const values = sheet.getRange(2, lastCol, lastRow - 1, 1).getValues();
  return values.map(function(row) { return safeText_(row[0]); }).filter(function(t) { return t.length > 0; });
}

function generateAISummary() {
  // DEPRECATED (2026-06-17): AI insights are generated on-demand by the
  // Next.js /api/gemini-insights route, which uses a hardened prompt with
  // injection-safe comment delimiters and per-cycle persistence.
  // This function is retained only for manual sheet-side testing and MUST NOT
  // be called from the pipeline. Delete after a validation period.
  Logger.log("generateAISummary is deprecated. Use /api/gemini-insights instead.");

  const apiKey = PropertiesService.getScriptProperties().getProperty(PULSE_CONFIG.GEMINI_API_KEY_PROPERTY);

  if (!apiKey) {
    Logger.log("No Gemini API key set. Skipping AI summary.");
    return null;
  }

  const rows = readScoreRows();
  const openText = readOpenTextResponses();
  const settings = readSettings();

  if (openText.length < 3) {
    Logger.log("Not enough open-text responses for AI analysis (" + openText.length + "). Need at least 3.");
    return null;
  }

  const scoreSummary = rows.map(function(row) {
    return row.area + ": " + (isFinite(row.score) ? row.score.toFixed(2) : "n/a") + " (" + row.status + ")";
  }).join("\n");

  // Anonymised open-text only — never include timestamps or identifying info
  const anonymisedText = openText.slice(0, 20).join("\n- ");

  const prompt =
    "You are a team engagement analyst. Analyse the following team survey results and recommend 2-3 key themes for leadership to focus on.\n\n" +
    "Survey cycle: " + (settings.currentCycle || "Unknown") + "\n\n" +
    "Score summary:\n" + scoreSummary + "\n\n" +
    "Anonymous team comments (do not quote directly, summarise only):\n- " + anonymisedText + "\n\n" +
    "Provide:\n" +
    "1. Two or three key theme labels (e.g. Workload Pressure, Communication Gaps).\n" +
    "2. One short paragraph summary per theme (2-3 sentences max).\n" +
    "3. One practical leadership action per theme.\n" +
    "Keep tone factual and constructive. Do not identify individuals. Do not overstate certainty if response count is low.";

  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + apiKey;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }]
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  };

  var response;
  try {
    response = UrlFetchApp.fetch(url, options);
  } catch (e) {
    Logger.log("Gemini request failed: " + e.message);
    return null;
  }

  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code === 429) {
    Logger.log("Gemini quota exceeded (429). Skipping AI summary. Retry later.");
    return null;
  }

  if (code < 200 || code >= 300) {
    Logger.log("Gemini API error: HTTP " + code + " — " + body);
    return null;
  }

  try {
    const json = JSON.parse(body);
    const aiText = json.candidates[0].content.parts[0].text;
    writeAISummaryToSheet_(aiText, settings.currentCycle || "Unknown");
    return aiText;
  } catch (e) {
    Logger.log("Could not parse Gemini response: " + e.message);
    return null;
  }
}

function writeAISummaryToSheet_(aiText, cycle) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, PULSE_CONFIG.AI_OUTPUT_SHEET);

  const now = formatNow_(PULSE_CONFIG.DATE_FORMAT);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Cycle", "Generated At", "AI Theme Analysis (Human Review Required)"]);
    sheet.setColumnWidth(3, 800);
    sheet.getRange(1, 1, 1, 3).setFontWeight("bold");
  }

  sheet.appendRow([cycle, now, aiText]);
  sheet.getRange(sheet.getLastRow(), 3).setWrap(true);

  Logger.log("AI summary written to AI Insights Log tab.");
}
