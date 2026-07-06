/**
 * B2CSS Pulse Dashboard — Apps Script JSON Endpoint
 * ────────────────────────────────────────────────────────────────────────────
 * PULSE CADENCE: Runs every 6 weeks. Cycle labels use short month-year format:
 *   e.g. "Jun '26", "Apr '26", "Feb '26"
 *
 * HOW TO USE:
 *   1. Open your Google Sheet → Extensions → Apps Script
 *   2. Paste this entire file into Code.gs (replace existing content)
 *   3. Click Deploy → New Deployment → Web App
 *      - Execute as: Me
 *      - Who has access: Anyone (or "Anyone within [org]" for internal use)
 *   4. Copy the deployment URL
 *   5. Paste it into pulse-dashboard/.env.local as APPS_SCRIPT_URL=<url>
 *
 * SHEET TABS REQUIRED:
 *   - Summary              col A = area name, col B = current score
 *                          also has label/value rows (e.g. "Total Responses" | 42)
 *   - Trend                col A = pulse label, col B = overall score,
 *                          col C+ = per-area scores (header row 1 matches AREA_NAMES)
 *   - Recommendation Themes col A = theme, col B = frequency, col C = action,
 *                          col D = pulses active (optional), col E = area link (optional)
 *   - Action Tracker       col A = concern, col B = action, col C = owner,
 *                          col D = status, col E = pulse opened, col F = area
 *   - Settings             key/value pairs: "Current Cycle", "Narrative Summary",
 *                          "Strong Threshold", "Stable Threshold", "Watch Threshold"
 *
 * CUSTOM MENU (appears in Google Sheets toolbar after opening the sheet):
 *   Pulse Dashboard > Archive this pulse cycle  — appends current scores to Trend
 *   Pulse Dashboard > Validate sheet structure  — checks all required tabs exist
 */

// ── Sheet name constants ──────────────────────────────────────────────────────
var SHEET_SUMMARY         = "Summary";
var SHEET_TREND           = "Trend";
var SHEET_RECOMMENDATIONS = "Recommendation Themes";
var SHEET_SETTINGS        = "Settings";
var SHEET_ACTIONS         = "Action Tracker";
var SHEET_ROLE_SPLIT      = "Role Split";      // optional: per-area scores by role group
var SHEET_ROLE_SPLIT_SUMMARY = "Role Split Summary";
var SHEET_AI_INSIGHTS     = "AI Insights";

// ── Shared-secret access control ──────────────────────────────────────────────
// Set the secret once via Script Properties: API_SHARED_SECRET = <random string>
// The Next.js app must send the same value as APPS_SCRIPT_SECRET on every request.
var API_SECRET_PROPERTY_KEY = "API_SHARED_SECRET";

function isAuthorized_(providedSecret) {
  var expected = PropertiesService.getScriptProperties().getProperty(API_SECRET_PROPERTY_KEY);
  // If no secret is configured yet, fail closed (deny) rather than silently allowing everyone.
  if (!expected) return false;
  return String(providedSecret || "") === expected;
}

function unauthorizedResponse_() {
  return ContentService
    .createTextOutput(JSON.stringify({ error: true, message: "Unauthorized" }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Default thresholds (overridden by Settings sheet if present) ─────────────
var DEFAULT_THRESHOLD_STRONG = 4.0;
var DEFAULT_THRESHOLD_STABLE = 3.5;
var DEFAULT_THRESHOLD_WATCH  = 3.0;

// ── Area names (must match Summary sheet rows exactly) ───────────────────────
var AREA_NAMES = [
  "Direction & Priorities",
  "Value & Focus",
  "Ownership & Empowerment",
  "Ways of Working",
  "Collaboration & Support",
  "Workload & Sustainability",
  "Team Climate & Safety",
];

// ── Custom menu ───────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Pulse Dashboard")
    .addItem("🚀 Run Full Pipeline", "runFullPipelineFromMenu")
    .addSeparator()
    .addItem("Archive this pulse cycle (Read-only)", "archiveCurrentCycleTrend")
    .addItem("Validate sheet structure", "validateAndAlert")
    .addToUi();
}

function runFullPipelineFromMenu() {
  if (typeof runFullPipeline !== "function") {
    SpreadsheetApp.getUi().alert("runFullPipeline() not found. Ensure Summary.gs is included in this project.");
    return;
  }

  var ui = SpreadsheetApp.getUi();
  var choice = ui.alert(
    "Broadcast to Slack",
    "Send the Pulse Summary to the Slack channel?",
    ui.ButtonSet.YES_NO_CANCEL
  );

  if (choice === ui.Button.CANCEL || choice === ui.Button.CLOSE) return;

  setSendToSlackApproved_(choice === ui.Button.YES);
  runFullPipeline();
}

function setSendToSlackApproved_(approved) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheet) return;

  var values = sheet.getDataRange().getValues();
  for (var r = 0; r < values.length; r++) {
    if (normalizeLabel(values[r][0]) === "sendtoslackapproved") {
      sheet.getRange(r + 1, 2).setValue(approved ? "TRUE" : "FALSE");
      return;
    }
  }
}

// ── Main endpoint ─────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    var providedSecret = String((e && e.parameter && e.parameter.secret) || "").trim();
    if (!isAuthorized_(providedSecret)) {
      return unauthorizedResponse_();
    }

    var action = String((e && e.parameter && e.parameter.action) || "").trim();
    if (action === "getAiInsight") {
      var cycleParam = String((e && e.parameter && e.parameter.cycle) || "").trim();
      if (typeof getAiInsightResponse_ !== "function") {
        return ContentService
          .createTextOutput(JSON.stringify({
            found: false,
            cycle: cycleParam,
            summary: "",
            rows: [],
            message: "AI insight helper unavailable"
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService
        .createTextOutput(JSON.stringify(getAiInsightResponse_(cycleParam)))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var validation = validateSheets();
    if (!validation.ok) {
      return ContentService
        .createTextOutput(JSON.stringify({ error: true, message: validation.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var ss             = SpreadsheetApp.getActiveSpreadsheet();
    var thresholds     = getThresholds(ss);
    var trends         = getTrends(ss);
    var summary        = getSummary(ss, thresholds, trends);
    var areaScores     = getAreaScores(ss, thresholds, trends);
    var recommendations = getRecommendations(ss);

    // ── Enrich summary with lowest-area stats (avoids frontend lookup) ────
    var lowestEntry = null;
    for (var li = 0; li < areaScores.length; li++) {
      if (areaScores[li].area === summary.lowestArea) { lowestEntry = areaScores[li]; break; }
    }
    if (lowestEntry) {
      summary.lowestAreaScore = lowestEntry.score;
      if (lowestEntry.pulsesAtRisk) summary.lowestAreaPulsesAtRisk = lowestEntry.pulsesAtRisk;
    }

    // ── scoreDelta: change from previous to current overall score ─────────
    if (trends.length >= 2) {
      summary.scoreDelta = Math.round(
        (trends[trends.length - 1].overallScore - trends[trends.length - 2].overallScore) * 10
      ) / 10;
    }

    // ── prevCycle ─────────────────────────────────────────────────────────
    var prevCycle = trends.length >= 2 ? trends[trends.length - 2].cycle : null;

    // ── focusSuggestion: recommendation action for the lowest-scoring area ─
    var focusSuggestion = null;
    var matchedRec = null;
    for (var ri = 0; ri < recommendations.length; ri++) {
      if (recommendations[ri].areaLink === summary.lowestArea) {
        matchedRec = recommendations[ri];
        break;
      }
    }
    if (!matchedRec && summary.lowestArea) {
      var firstWord = summary.lowestArea.split(" ")[0].toLowerCase();
      for (var ri2 = 0; ri2 < recommendations.length; ri2++) {
        if (recommendations[ri2].theme.toLowerCase().indexOf(firstWord) !== -1) {
          matchedRec = recommendations[ri2];
          break;
        }
      }
    }
    if (matchedRec) focusSuggestion = matchedRec.suggestedAction;

    var payload = {
      cycle:            getDashboardCycle(ss, trends),
      generatedDate:    getGeneratedDate(),
      narrativeSummary: getNarrativeSummary(ss, summary, trends),
      summary:          summary,
      areaScores:       areaScores,
      prevCycle:        prevCycle,
      focusSuggestion:  focusSuggestion,
      trends:           trends,
      recommendations:  recommendations,
      actions:          getActions(ss),
      roleSplit:        getRoleSplit(ss),
      responseCounts:   getResponseCounts(ss, trends),
      responseMix:      getCurrentPulseResponseMix(ss),
    };

    return ContentService
      .createTextOutput(JSON.stringify(payload))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (e) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: true, message: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Sheet validation ──────────────────────────────────────────────────────────
function validateSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // Keep only core tabs as hard requirements; recommendations/actions are optional.
  var required = [SHEET_SUMMARY, SHEET_TREND, SHEET_SETTINGS];
  var missing = required.filter(function(name) { return !ss.getSheetByName(name); });
  if (missing.length) {
    return { ok: false, message: "Missing sheets: " + missing.join(", ") };
  }
  return { ok: true };
}

function validateAndAlert() {
  var result = validateSheets();
  var ui = SpreadsheetApp.getUi();
  if (result.ok) {
    ui.alert("All required sheets found. Structure is valid.");
  } else {
    ui.alert("Sheet structure problem:\n" + result.message);
  }
}

// ── Thresholds ────────────────────────────────────────────────────────────────
function getThresholds(ss) {
  var map = getSheetAsMap(ss.getSheetByName(SHEET_SETTINGS));
  return {
    strong: parseFloat(map["strongthreshold"]) || DEFAULT_THRESHOLD_STRONG,
    stable: parseFloat(map["stablethreshold"]) || DEFAULT_THRESHOLD_STABLE,
    watch:  parseFloat(map["watchthreshold"])  || DEFAULT_THRESHOLD_WATCH,
  };
}

function scoreToStatus(score, thresholds) {
  if (score >= thresholds.strong) return "Strong";
  if (score >= thresholds.stable) return "Stable";
  if (score >= thresholds.watch)  return "Watch";
  return "At Risk";
}

// ── Settings ──────────────────────────────────────────────────────────────────
function getCycle(ss) {
  var map = getSheetAsMap(ss.getSheetByName(SHEET_SETTINGS));
  return map["currentcycle"] ? String(map["currentcycle"]).trim() : "Unknown Pulse";
}

function getDashboardCycle(ss, trends) {
  if (trends && trends.length > 0) {
    var latest = String(trends[trends.length - 1].cycle || "").trim();
    if (latest) return latest;
  }
  return getCycle(ss);
}

function getGeneratedDate() {
  return formatNow_("yyyy-MM-dd");
}

// ── Summary ───────────────────────────────────────────────────────────────────
function getSummary(ss, thresholds, trends) {
  var map = getSheetAsMap(ss.getSheetByName(SHEET_SUMMARY));
  var settingsMap = getSheetAsMap(ss.getSheetByName(SHEET_SETTINGS));

  var totalResponses = Number(map["totalresponses"] || map["totalresponse"] || map["responsestotal"]) || 0;
  var teamSize       = Number(settingsMap["teamsize"] || settingsMap["totalteam"] || settingsMap["headcount"]) || 0;
  var overallScore   = parseFloat(map["overallscore"] || map["averagescore"]) || 0;
  var highestArea    = String(map["highestarea"] || map["toparea"] || "");
  var lowestArea     = String(map["lowestarea"] || map["bottomarea"] || "");

  // Override with latest Trend's overall score (current pulse, not Summary's static value)
  if (trends && trends.length > 0) {
    var latestTrendScore = parseFloat(trends[trends.length - 1].overallScore);
    if (!isNaN(latestTrendScore) && latestTrendScore > 0) {
      overallScore = latestTrendScore;
    }
  }

  // Re-derive totalResponses from Form Responses filtered by active cycle.
  // The Summary sheet value is an all-time total; we need only the current pulse count.
  var settings = typeof readSettings === "function" ? readSettings() : {};
  var formSheetName = settings.formSheetName || PULSE_CONFIG.FORM_RESPONSE_SHEET;
  var formSheet = ss.getSheetByName(formSheetName);
  if (formSheet && formSheet.getLastRow() > 1) {
    var formData = formSheet.getDataRange().getValues();
    var formHeaders = formData[0];
    var fCycleCol = -1;
    for (var fh = 0; fh < formHeaders.length; fh++) {
      var fhn = normalizeLabel(formHeaders[fh]);
      if (fhn === "pulsecycle" || fhn === "cycle") { fCycleCol = fh; break; }
    }
    var activeCycleLabel = (trends && trends.length > 0)
      ? String(trends[trends.length - 1].cycle || "").trim()
      : getCycle(ss);
    if (fCycleCol >= 0 && activeCycleLabel) {
      var cycleCount = 0;
      for (var fr = 1; fr < formData.length; fr++) {
        if (String(formData[fr][fCycleCol] || "").trim() === activeCycleLabel) cycleCount++;
      }
      if (cycleCount > 0) totalResponses = cycleCount;
    } else if (!totalResponses) {
      totalResponses = formSheet.getLastRow() - 1;
    }
  }

  // Fallback: if no explicit Overall Score row, compute average from the 7 area rows
  if (!overallScore) {
    var areaKeys = AREA_NAMES.map(function(n) { return normalizeLabel(n); });
    var areaVals = areaKeys.map(function(k) { return parseFloat(map[k]) || 0; })
                           .filter(function(v) { return v > 0; });
    if (areaVals.length > 0) {
      overallScore = Math.round(areaVals.reduce(function(a, b) { return a + b; }, 0) / areaVals.length * 10) / 10;
    }
  }

  // Fallback: auto-compute highestArea / lowestArea from area scores in the map
  // when the Summary sheet has no explicit "Highest Area" / "Lowest Area" rows.
  if (!highestArea || !lowestArea) {
    var bestArea = "", bestScore = -1, worstArea = "", worstScore = 99;
    for (var ai = 0; ai < AREA_NAMES.length; ai++) {
      var areaKey = normalizeLabel(AREA_NAMES[ai]);
      var areaScore = parseFloat(map[areaKey]);
      if (isNaN(areaScore)) continue;
      if (areaScore > bestScore)  { bestScore  = areaScore; bestArea  = AREA_NAMES[ai]; }
      if (areaScore < worstScore) { worstScore = areaScore; worstArea = AREA_NAMES[ai]; }
    }
    if (!highestArea && bestArea)  highestArea = bestArea;
    if (!lowestArea  && worstArea) lowestArea  = worstArea;
  }

  // Fallback: count Form Responses rows when Summary has no "Total Responses" row
  if (!totalResponses) {
    var settingsFallback = typeof readSettings === "function" ? readSettings() : {};
    var formSheetNameFallback = settingsFallback.formSheetName || PULSE_CONFIG.FORM_RESPONSE_SHEET;
    var formSheetFallback = ss.getSheetByName(formSheetNameFallback);
    if (formSheetFallback && formSheetFallback.getLastRow() > 1) {
      totalResponses = formSheetFallback.getLastRow() - 1; // subtract header row
    }
  }

  // Derive status from score — never rely on a human-typed label in the sheet
  var overallStatus = scoreToStatus(overallScore, thresholds);

  return {
    totalResponses: totalResponses,
    teamSize:       teamSize || undefined,
    overallScore:   overallScore,
    overallStatus:  overallStatus,
    highestArea:    highestArea,
    lowestArea:     lowestArea,
  };
}

// ── Trend history ─────────────────────────────────────────────────────────────
/**
 * Reads the Trend sheet. Row 1 = headers.
 *   Col A = pulse label (e.g. "Jun '26")
 *   Col B = overall score
 *   Col C+ = per-area scores
 */
function getTrends(ss) {
  var sheet = ss.getSheetByName(SHEET_TREND);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var headers = data[0];
  var trends = [];

  for (var i = 1; i < data.length; i++) {
    var cycle = String(data[i][0]).trim();
    var score = parseFloat(data[i][1]);
    if (!cycle || isNaN(score)) continue;

    var point = { cycle: cycle, overallScore: score };

    for (var c = 2; c < headers.length; c++) {
      var areaName = String(headers[c]).trim();
      var areaScore = parseFloat(data[i][c]);
      if (areaName && !isNaN(areaScore)) point[areaName] = areaScore;
    }

    trends.push(point);
  }

  return trends;
}

// ── Area Scores ───────────────────────────────────────────────────────────────
/**
 * Reads area scores from Summary sheet (col A = area name, col B = score).
 * Computes delta and pulsesAtRisk automatically from Trend history —
 * no manual columns needed in the Summary sheet.
 */
function getAreaScores(ss, thresholds, trends) {
  var sheet = ss.getSheetByName(SHEET_SUMMARY);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  var scores = [];

  for (var i = 0; i < data.length; i++) {
    var area = String(data[i][0]).trim();
    if (AREA_NAMES.indexOf(area) === -1) continue;

    var score = parseFloat(data[i][1]) || 0;
    var entry = { area: area, score: score };

    // Auto-compute delta from Trend per-area history
    if (trends.length >= 2) {
      var prevPoint      = trends[trends.length - 2];
      var prevAreaScore  = parseFloat(prevPoint[area]);
      if (!isNaN(prevAreaScore)) {
        entry.delta = Math.round((score - prevAreaScore) * 10) / 10;
      }
    }

    // Auto-compute pulsesAtRisk: count consecutive pulses below stable threshold
    var streak = 0;
    for (var t = trends.length - 1; t >= 0; t--) {
      var trendAreaScore = parseFloat(trends[t][area]);
      if (!isNaN(trendAreaScore) && trendAreaScore < thresholds.stable) {
        streak++;
      } else {
        break;
      }
    }
    if (streak > 0) entry.pulsesAtRisk = streak;

    scores.push(entry);
  }
  return scores;
}

// ── Narrative summary ─────────────────────────────────────────────────────────
function getNarrativeSummary(ss, summary, trends) {
  // Custom override from Settings takes priority
  var map    = getSheetAsMap(ss.getSheetByName(SHEET_SETTINGS));
  var custom = map["narrativesummary"] || map["executivesummary"];
  if (custom && String(custom).trim()) return String(custom).trim();

  // Auto-generate from data
  // Use latest trend score as source of truth (mirrors frontend trend-first logic).
  var resolvedScore = (trends && trends.length > 0 && parseFloat(trends[trends.length - 1].overallScore) > 0)
    ? parseFloat(trends[trends.length - 1].overallScore)
    : (summary.overallScore || 0);
  var score   = resolvedScore.toFixed(1);
  var status  = (summary.overallStatus || "Stable").toLowerCase();
  var lowest  = summary.lowestArea  || "\u2014";
  var highest = summary.highestArea || "\u2014";

  var deltaStr = "";
  if (trends.length >= 2) {
    var prev = trends[trends.length - 2].overallScore;
    var curr = trends[trends.length - 1].overallScore;
    var diff = Math.round((curr - prev) * 10) / 10;
    var prevLabel = trends[trends.length - 2].cycle;
    if (diff > 0)      deltaStr = ", up "   + diff.toFixed(1) + " from " + prevLabel;
    else if (diff < 0) deltaStr = ", down " + Math.abs(diff).toFixed(1) + " from " + prevLabel;
    else               deltaStr = ", unchanged from " + prevLabel;
  }

  // Find biggest per-area improvement this pulse
  var biggestMover = "";
  if (trends.length >= 2) {
    var maxDelta = 0;
    for (var a = 0; a < AREA_NAMES.length; a++) {
      var area  = AREA_NAMES[a];
      var prev2 = parseFloat(trends[trends.length - 2][area]);
      var curr2 = parseFloat(trends[trends.length - 1][area]);
      if (!isNaN(prev2) && !isNaN(curr2)) {
        var d = Math.round((curr2 - prev2) * 10) / 10;
        if (d > maxDelta) { maxDelta = d; biggestMover = area; }
      }
    }
    biggestMover = (biggestMover && maxDelta > 0)
      ? " " + biggestMover + " showed the biggest improvement (+\u200b" + maxDelta.toFixed(1) + ")."
      : "";
  }

  var streakNote = "";
  if (summary.lowestAreaPulsesAtRisk && summary.lowestAreaPulsesAtRisk >= 2) {
    streakNote = " " + lowest + " has been flagged for " + summary.lowestAreaPulsesAtRisk +
      " consecutive pulses.";
  }

  return "Team sentiment is " + status + " at " + score + "/5" + deltaStr + "." +
    (biggestMover || (" " + highest + " is the strongest area this pulse.")) +
    (streakNote   || (" " + lowest  + " remains the area requiring most attention."));
}

// ── Recurring signals (recommendation themes) ─────────────────────────────────
/**
 * Col A = theme, B = frequency, C = suggested action,
 * D = pulses active (optional), E = area link (optional)
 */
function getRecommendations(ss) {
  var sheet = ss.getSheetByName(SHEET_RECOMMENDATIONS);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  var recs = [];

  for (var i = 1; i < data.length; i++) {
    var theme = String(data[i][0]).trim();
    if (!theme) continue;

    var freq         = parseInt(data[i][1], 10);
    var action       = String(data[i][2] || "").trim();
    var pulsesActive = (data[i].length > 3 && data[i][3] !== "") ? parseInt(data[i][3], 10)   : null;
    var areaLink     = (data[i].length > 4 && data[i][4] !== "") ? String(data[i][4]).trim() : null;

    var rec = {
      theme:           theme,
      frequency:       isNaN(freq) ? 0 : freq,
      suggestedAction: action,
    };
    if (pulsesActive !== null && !isNaN(pulsesActive)) rec.pulsesActive = pulsesActive;
    if (areaLink) rec.areaLink = areaLink;

    recs.push(rec);
  }
  return recs;
}

// ── Commitments (action tracker) ──────────────────────────────────────────────
/**
 * Col A = concern, B = commitment/action, C = owner, D = status,
 * E = pulse opened, F = area
 */
function getActions(ss) {
  var sheet = ss.getSheetByName(SHEET_ACTIONS);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  var actions = [];

  for (var i = 1; i < data.length; i++) {
    var concern = String(data[i][0]).trim();
    if (!concern) continue;

    var action = {
      concern:         concern,
      suggestedAction: String(data[i][1] || "").trim(),
      owner:           String(data[i][2] || "").trim(),
      status:          String(data[i][3] || "").trim() || "Planned",
    };
    if (data[i].length > 4 && String(data[i][4]).trim()) action.pulseOpened = String(data[i][4]).trim();
    if (data[i].length > 5 && String(data[i][5]).trim()) action.area        = String(data[i][5]).trim();
    if (data[i].length > 6 && String(data[i][6]).trim()) action.notes       = String(data[i][6]).trim();

    actions.push(action);
  }
  return actions;
}

// ── Archive: append current cycle to Trend sheet ──────────────────────────────
function archiveCurrentCycleTrend() {
  var ui = SpreadsheetApp.getUi();
  ui.alert(
    "Manual archive is disabled.\n\n" +
    "Trend is populated only by the canonical pipeline: Run Full Pipeline (generateLeadershipSummary -> appendTrend).\n\n" +
    "Use Pulse Dashboard > 🚀 Run Full Pipeline to update Trend."
  );
}

// ── Role Split ────────────────────────────────────────────────────────────────
/**
 * Gets role split data using fallback strategy.
 * Delegates to RoleSplitService for computation and caching logic.
 * @deprecated Use getRoleSplitWithFallback() from RoleSplitService.gs instead
 */
function getRoleSplit(ss) {
  var trends = getTrends(ss);
  var activeCycle = (trends.length > 0)
    ? String(trends[trends.length - 1].cycle || "").trim()
    : getCycle(ss);
  if (typeof getRoleSplitWithFallback === "function") {
    try {
      return getRoleSplitWithFallback(ss, activeCycle);
    } catch (e) {
      Logger.log("Role split fallback failed: " + e.message);
      return [];
    }
  }
  Logger.log("Role split helper unavailable; returning empty role split.");
  return [];
}

// ── Response Counts ───────────────────────────────────────────────────────────
/**
 * Builds response count per pulse from the Trend sheet (col A = cycle label).
 * If the Trend sheet has a "Total Responses" column it uses that; otherwise
 * it falls back to the current pulse totalResponses from summary for the
 * latest cycle, and omits count for historical cycles.
 * Returns points only for cycles that have a count.
 */
function getResponseCounts(ss, trends) {
  var fromFormResponses = getResponseCountsFromFormResponses_(ss, trends);
  if (fromFormResponses.length > 0) return fromFormResponses;

  // Fallback path: legacy behavior from Trend sheet response column.
  var sheet = ss.getSheetByName(SHEET_TREND);
  var points = [];

  if (!sheet || trends.length === 0) return points;

  var data    = sheet.getDataRange().getValues();
  if (data.length < 2) return points;

  var headers = data[0];
  // Find a "Total Responses" or "Responses" column if it exists
  var responseCol = -1;
  for (var c = 0; c < headers.length; c++) {
    var h = normalizeLabel(headers[c]);
    if (h === "totalresponses" || h === "responses" || h === "responsecount") {
      responseCol = c;
      break;
    }
  }

  for (var i = 1; i < data.length; i++) {
    var cycle = String(data[i][0]).trim();
    if (!cycle) continue;
    if (responseCol >= 0) {
      var count = parseInt(data[i][responseCol], 10);
      if (!isNaN(count) && count > 0) {
        points.push({ cycle: cycle, responseCount: count });
      }
    }
  }

  // If no response column exists, at minimum surface current cycle count from summary
  if (points.length === 0) {
    var summaryMap = getSheetAsMap(ss.getSheetByName(SHEET_SUMMARY));
    var current = parseInt(summaryMap["totalresponses"] || "0", 10) || 0;
    var latestCycle = trends[trends.length - 1].cycle;
    if (current > 0) {
      points.push({ cycle: latestCycle, responseCount: current });
    }
  }

  return points;
}

/**
 * Primary source for participation trend:
 * counts Form Responses rows grouped by pulse cycle and aligns them to Trend cycles.
 * This avoids manual/edited response counts inside the Trend sheet.
 */
function getResponseCountsFromFormResponses_(ss, trends) {
  trends = trends || [];

  var settings = (typeof readSettings === "function") ? readSettings() : {};
  var sheetName = settings.formSheetName ||
    ((typeof PULSE_CONFIG !== "undefined" && PULSE_CONFIG.FORM_RESPONSE_SHEET)
      ? PULSE_CONFIG.FORM_RESPONSE_SHEET
      : "Form Responses 1");

  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  // Detect cycle column from header labels.
  var cycleCol = -1;
  for (var c = 0; c < headers.length; c++) {
    var h = normalizeLabel(headers[c]);
    if (h === "pulsecycle" || h === "cycle") {
      cycleCol = c;
      break;
    }
  }
  if (cycleCol < 0) return [];

  var rawCounts = {};     // exact cycle label -> count
  var normCounts = {};    // normalized label -> count (format-tolerant match)

  for (var i = 1; i < data.length; i++) {
    var cycle = String(data[i][cycleCol] || "").trim();
    if (!cycle) continue;

    rawCounts[cycle] = (rawCounts[cycle] || 0) + 1;

    var nk = normalizeLabel(cycle);
    if (nk) normCounts[nk] = (normCounts[nk] || 0) + 1;
  }

  var points = [];
  var pointKeys = {};
  var trendOrder = {};
  for (var ti = 0; ti < (trends || []).length; ti++) {
    var trendKey = normalizeLabel(String(trends[ti].cycle || "").trim());
    if (trendKey && trendOrder[trendKey] === undefined) trendOrder[trendKey] = ti;
  }

  // First, keep trend-aligned points when matching counts exist.
  for (var t = 0; t < trends.length; t++) {
    var trendCycle = String(trends[t].cycle || "").trim();
    if (!trendCycle) continue;

    var count = rawCounts[trendCycle] || 0;
    if (!count) {
      var trendNorm = normalizeLabel(trendCycle);
      if (trendNorm && normCounts[trendNorm]) count = normCounts[trendNorm];
    }

    if (count > 0) {
      points.push({ cycle: trendCycle, responseCount: count });
      pointKeys[normalizeLabel(trendCycle)] = true;
    }
  }

  // Then include cycles found in Form Responses but missing from Trend.
  var formCycles = Object.keys(rawCounts);
  for (var fc = 0; fc < formCycles.length; fc++) {
    var formCycle = formCycles[fc];
    var formKey = normalizeLabel(formCycle);
    if (!formKey || pointKeys[formKey]) continue;
    points.push({ cycle: formCycle, responseCount: rawCounts[formCycle] });
    pointKeys[formKey] = true;
  }

  // Sort by trend order when available, otherwise by pulse number (e.g. Pulse 1, Pulse 2).
  points.sort(function(a, b) {
    var ak = normalizeLabel(a.cycle);
    var bk = normalizeLabel(b.cycle);
    var ai = trendOrder[ak];
    var bi = trendOrder[bk];

    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;

    var an = parseInt(String(a.cycle).replace(/[^0-9]/g, ""), 10);
    var bn = parseInt(String(b.cycle).replace(/[^0-9]/g, ""), 10);
    if (!isNaN(an) && !isNaN(bn) && an !== bn) return an - bn;

    return String(a.cycle).localeCompare(String(b.cycle));
  });

  return points;
}

// ── Current Pulse Response Mix ───────────────────────────────────────────────
/**
 * Builds current pulse response mix by area:
 *   positive = score 4-5 (Good/Very Good)
 *   mixed    = score 3   (Neutral)
 *   negative = score 1-2 (Poor/Very Poor)
 *
 * If a "Pulse Cycle" column exists, rows are filtered to the active cycle
 * from Settings > Current Cycle. If not present, all rows are used.
 */
function getCurrentPulseResponseMix(ss) {
  var settings  = typeof readSettings === "function" ? readSettings() : {};
  var sheetName = settings.formSheetName || PULSE_CONFIG.FORM_RESPONSE_SHEET;
  var sheet     = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var rows    = data.slice(1);

  var cycleCol = -1;
  for (var i = 0; i < headers.length; i++) {
    var hn = normalizeLabel(headers[i]);
    if (hn === "pulsecycle" || hn === "cycle") {
      cycleCol = i;
      break;
    }
  }

  // Use the same Trend-first source as getDashboardCycle to stay in sync.
  var trends = getTrends(ss);
  var activeCycle = (trends.length > 0)
    ? String(trends[trends.length - 1].cycle || "").trim()
    : getCycle(ss);
  if (cycleCol >= 0 && activeCycle) {
    rows = rows.filter(function(r) {
      return String(r[cycleCol] || "").trim() === activeCycle;
    });
  }

  // Match area columns from headers (supports either exact area name or long question text)
  var areaCols = [];
  for (var a = 0; a < AREA_NAMES.length; a++) {
    var area = AREA_NAMES[a];
    var areaNorm = normalizeLabel(area);
    var found = -1;
    for (var c = 0; c < headers.length; c++) {
      var hNorm = normalizeLabel(headers[c]);
      if (!hNorm) continue;
      if (hNorm === areaNorm || hNorm.indexOf(areaNorm) !== -1) {
        found = c;
        break;
      }
    }
    if (found >= 0) {
      areaCols.push({ area: area, col: found });
    }
  }

  if (!areaCols.length || !rows.length) return [];

  var out = [];
  for (var ac = 0; ac < areaCols.length; ac++) {
    var areaName = areaCols[ac].area;
    var col      = areaCols[ac].col;
    var pos = 0, mix = 0, neg = 0, total = 0;

    for (var r = 0; r < rows.length; r++) {
      var score = mapPulseValueToScore_(rows[r][col]);
      if (score === null) continue;
      total += 1;
      if (score >= 4) pos += 1;
      else if (score === 3) mix += 1;
      else neg += 1;
    }

    if (total === 0) continue;

    var posPct = Math.round((pos / total) * 100);
    var mixPct = Math.round((mix / total) * 100);
    var negPct = 100 - posPct - mixPct; // keep row total exactly 100

    out.push({
      area: areaName,
      positive: posPct,
      mixed: mixPct,
      negative: negPct,
      total: total,
    });
  }

  return out;
}

/**
 * Converts form value to numeric score (1..5) when possible.
 * Supports both numeric values and text labels.
 */
function mapPulseValueToScore_(value) {
  if (value === null || value === undefined) return null;
  var raw = String(value).trim();
  if (!raw) return null;

  var num = parseFloat(raw);
  if (!isNaN(num) && num >= 1 && num <= 5) return num;

  var t = normalizeLabel(raw);
  if (t === "verypoor") return 1;
  if (t === "poor") return 2;
  if (t === "neutral") return 3;
  if (t === "good") return 4;
  if (t === "verygood") return 5;

  return null;
}

// ── Utility: single-pass sheet key→value map ──────────────────────────────────
/**
 * Reads the entire sheet ONCE and returns a normalised key→value map.
 * Each row: if a cell contains a label-like string and the next non-empty cell
 * is on the same row, that pair is stored as map[normalizeLabel(label)] = value.
 * Normalisation: strip all non-alphanumeric characters, lowercase.
 * This replaces repeated getCellByLabel() calls (one sheet read per request).
 */
function getSheetAsMap(sheet) {
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var map  = {};
  for (var i = 0; i < data.length; i++) {
    for (var c = 0; c < data[i].length - 1; c++) {
      var key = normalizeLabel(data[i][c]);
      if (!key) continue;
      for (var r = c + 1; r < data[i].length; r++) {
        if (String(data[i][r]).trim() !== "") {
          if (!map[key]) map[key] = data[i][r]; // first match wins
          break;
        }
      }
    }
  }
  return map;
}

function normalizeLabel(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getAiInsightResponse_(cycleParam) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var targetCycle = safeText_(cycleParam);

  // Prefer cycle-level persistence sheet, then fallback to AI output log.
  var primary = ss.getSheetByName(SHEET_AI_INSIGHTS);
  var fallback = ss.getSheetByName(PULSE_CONFIG.AI_OUTPUT_SHEET);
  var sheet = primary || fallback;

  if (!sheet || sheet.getLastRow() < 2) {
    return {
      found: false,
      cycle: targetCycle || "",
      summary: "",
      rows: [],
      message: "No AI insight available"
    };
  }

  var data = sheet.getDataRange().getValues();
  var headers = data[0] || [];
  var cycleCol = 0;
  var summaryCol = -1;
  var rowsCol = -1;
  var fingerprintCol = -1;
  var generatedByCol = -1;
  var updatedAtCol = -1;

  for (var h = 0; h < headers.length; h++) {
    var hn = normalizeLabel(headers[h]);
    if (hn === "cycle" || hn === "pulsecycle") cycleCol = h;
    if (hn === "summary" || hn === "insightsummary" || hn === "aithemeanalysishumanreviewrequired") summaryCol = h;
    if (hn === "rowsjson" || hn === "rows") rowsCol = h;
    if (hn === "datafingerprint") fingerprintCol = h;
    if (hn === "generatedby") generatedByCol = h;
    if (hn === "updatedat" || hn === "generatedat") updatedAtCol = h;
  }

  // If the sheet is AI Insights Log format, summary is usually col 3.
  if (summaryCol < 0 && headers.length >= 3) summaryCol = 2;

  var bestRow = null;
  for (var r = data.length - 1; r >= 1; r--) {
    var rowCycle = safeText_(data[r][cycleCol]);
    if (!rowCycle) continue;
    if (targetCycle && rowCycle !== targetCycle) continue;
    bestRow = data[r];
    break;
  }

  if (!bestRow) {
    return {
      found: false,
      cycle: targetCycle || "",
      summary: "",
      rows: [],
      message: "No AI insight found for requested cycle"
    };
  }

  var parsedRows = [];
  if (rowsCol >= 0 && safeText_(bestRow[rowsCol])) {
    try {
      parsedRows = JSON.parse(String(bestRow[rowsCol]));
      if (!Array.isArray(parsedRows)) parsedRows = [];
    } catch (e) {
      parsedRows = [];
    }
  }

  return {
    found: true,
    cycle: safeText_(bestRow[cycleCol]),
    summary: summaryCol >= 0 ? safeText_(bestRow[summaryCol]) : "",
    rows: parsedRows,
    dataFingerprint: fingerprintCol >= 0 ? safeText_(bestRow[fingerprintCol]) : "",
    generatedBy: generatedByCol >= 0 ? safeText_(bestRow[generatedByCol]) : "",
    updatedAt: updatedAtCol >= 0 ? safeText_(bestRow[updatedAtCol]) : ""
  };
}

function stringifyRowsForCell_(rows) {
  var text = "[]";
  try {
    text = JSON.stringify(Array.isArray(rows) ? rows : []);
  } catch (e) {
    text = "[]";
  }

  // Keep comfortably below 50k cell text limit.
  if (text.length > 45000) {
    return text.substring(0, 44980) + "...";
  }
  return text;
}

// ── AI Insights persistence (sheet-backed, one active record per cycle) ─────
function doPost(e) {
  try {
    var payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }

    if (!isAuthorized_(payload.secret)) {
      return unauthorizedResponse_();
    }

    var action = String(payload.action || "").trim();
    if (action === "upsertAiInsight") {
      var cycle = String(payload.cycle || "").trim();
      var summary = String(payload.summary || "").trim();
      var rows = Array.isArray(payload.rows) ? payload.rows : [];
      var dataFingerprint = String(payload.dataFingerprint || "").trim();
      var generatedBy = String(payload.generatedBy || "Dashboard UI").trim();
      var force = Boolean(payload.force);

      if (!cycle) {
        throw new Error("Missing required field: cycle");
      }

      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = getOrCreateSheet_(ss, SHEET_AI_INSIGHTS);
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["Cycle", "Summary", "RowsJson", "DataFingerprint", "GeneratedBy", "UpdatedAt", "Active"]);
        sheet.getRange(1, 1, 1, 7).setFontWeight("bold");
      }

      var values = sheet.getDataRange().getValues();
      var headers = values[0] || [];
      var cycleCol = 0, summaryCol = 1, rowsCol = 2, fpCol = 3, byCol = 4, atCol = 5, activeCol = 6;

      for (var hc = 0; hc < headers.length; hc++) {
        var hNorm = normalizeLabel(headers[hc]);
        if (hNorm === "cycle") cycleCol = hc;
        if (hNorm === "summary" || hNorm === "insightsummary") summaryCol = hc;
        if (hNorm === "rowsjson" || hNorm === "rows") rowsCol = hc;
        if (hNorm === "datafingerprint") fpCol = hc;
        if (hNorm === "generatedby") byCol = hc;
        if (hNorm === "updatedat" || hNorm === "generatedat") atCol = hc;
        if (hNorm === "active") activeCol = hc;
      }

      var existingRow = -1;
      for (var i = 1; i < values.length; i++) {
        if (safeText_(values[i][cycleCol]) === cycle) {
          existingRow = i + 1;
          break;
        }
      }

      var existingFingerprint = "";
      if (existingRow > 0) {
        existingFingerprint = safeText_(sheet.getRange(existingRow, fpCol + 1).getValue());
      }

      if (!force && dataFingerprint && existingFingerprint && existingFingerprint === dataFingerprint) {
        return ContentService
          .createTextOutput(JSON.stringify({ success: true, cycle: cycle, updated: false, reason: "unchanged" }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      var now = formatNow_(PULSE_CONFIG.DATE_FORMAT);
      var rowValues = new Array(Math.max(headers.length, 7));
      for (var z = 0; z < rowValues.length; z++) rowValues[z] = "";
      rowValues[cycleCol] = cycle;
      rowValues[summaryCol] = summary;
      rowValues[rowsCol] = stringifyRowsForCell_(rows);
      rowValues[fpCol] = dataFingerprint;
      rowValues[byCol] = generatedBy;
      rowValues[atCol] = now;
      rowValues[activeCol] = "TRUE";

      if (existingRow > 0) {
        sheet.getRange(existingRow, 1, 1, rowValues.length).setValues([rowValues]);
      } else {
        sheet.appendRow(rowValues);
        existingRow = sheet.getLastRow();
      }

      // Ensure only the latest row for this cycle is active.
      var lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        var cycleValues = sheet.getRange(2, cycleCol + 1, lastRow - 1, 1).getValues();
        for (var rr = 0; rr < cycleValues.length; rr++) {
          var rowIndex = rr + 2;
          if (safeText_(cycleValues[rr][0]) === cycle) {
            sheet.getRange(rowIndex, activeCol + 1).setValue(rowIndex === existingRow ? "TRUE" : "FALSE");
          }
        }
      }

      return ContentService
        .createTextOutput(JSON.stringify({ success: true, cycle: cycle, updated: true, row: existingRow }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService
      .createTextOutput(JSON.stringify({ error: true, message: "Unknown action" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: true, message: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
