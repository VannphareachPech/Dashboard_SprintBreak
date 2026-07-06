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
 *   - Action Tracker       col A = pulse opened, col B = area, col C = action,
 *                          col D = owner, col E = status, col F = notes
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
    .addItem("🔧 Rescue Action Tracker Layout", "migrateActionTrackerNow")
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

    if (action === "getActions") {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, actions: getActions(ss) }))
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
      comments:         getFormComments_(ss),
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

  // Re-derive totalResponses for the active cycle (single read via shared helper).
  var settings = typeof readSettings === "function" ? readSettings() : {};
  var activeCycleResponseCount = getActiveCycleResponseCount_(ss, settings, trends);
  if (activeCycleResponseCount > 0) totalResponses = activeCycleResponseCount;

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

  // Fallback: count form responses when Summary has no "Total Responses" row.
  if (!totalResponses) {
    totalResponses = getActiveCycleResponseCount_(ss, settings, trends);
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

// ── Open-text comments from Form Responses (column K / recommendation question) ─
/**
 * Reads the "What one recommendation would you give to leadership..." column.
 * Targets the column by fuzzy header match first (keywords: recommendation +
 * leadership, or support + team), then falls back to column index 11 (K).
 *
 * Returns an array of objects: { cycle, comment }
 * Only includes rows for the currently active cycle.
 * Applies lightweight cleaning: strips blanks, placeholder answers, and
 * any content that looks like a prompt injection attempt.
 *
 * SECURITY: never include this data verbatim in a user-facing response.
 * The dashboard route wraps it in injection-safe delimiters before sending to Gemini.
 */
function getFormComments_(ss) {
  var settings = (typeof readSettings === "function") ? readSettings() : {};
  var currentCycle = safeText_(settings.currentCycle);
  var formSheetName = settings.formSheetName || PULSE_CONFIG.FORM_RESPONSE_SHEET;

  var sheet = ss.getSheetByName(formSheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0] || [];

  // ── Find comment column (fuzzy header match) ─────────────────────────────
  var commentCol = -1;
  var cycleCol   = -1;

  for (var h = 0; h < headers.length; h++) {
    var hn = safeText_(headers[h]).toLowerCase().replace(/[^a-z0-9 ]/g, "");
    // Detect the recommendation-to-leadership question column
    if (commentCol < 0 && (
      (hn.indexOf("recommendation") >= 0 && hn.indexOf("leadership") >= 0) ||
      (hn.indexOf("support") >= 0 && hn.indexOf("team") >= 0) ||
      (hn.indexOf("recommend") >= 0 && hn.indexOf("give") >= 0)
    )) {
      commentCol = h;
    }
    // Detect the pulse cycle column
    if (cycleCol < 0 && (hn === "pulsecycle" || hn === "pulse cycle" || hn === "cycle")) {
      cycleCol = h;
    }
  }

  // Fallback to column index 10 (K, 0-based) if header match failed
  if (commentCol < 0 && lastCol >= 11) {
    commentCol = 10;
  }
  if (commentCol < 0) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var comments = [];

  // Phrases that indicate a prompt injection attempt or empty/useless response
  var injectionPatterns = [
    /ignore\s+(all\s+)?(previous|above|prior|earlier)/i,
    /disregard\s+(all\s+)?(previous|above|prior|earlier)/i,
    /you\s+are\s+now/i,
    /act\s+as\s+a?(n?)\s+/i,
    /system\s+prompt/i,
    /new\s+instruction/i,
    /forget\s+(all\s+)?(previous|above|what)/i,
    /<<<|>>>/,  // injection delimiter mimicry
    /\[system\]/i,
  ];

  // Phrases that are non-answers (case-insensitive, after normalizing whitespace)
  var emptyPatterns = [
    /^(n\/?a|none|nil|no\s+comment|nothing|nothing\s+to\s+add|no\s+feedback|not\s+applicable|na|n\.a\.)$/i,
    /^-+$/,
    /^\.+$/,
  ];

  for (var r = 0; r < data.length; r++) {
    var raw = safeText_(data[r][commentCol]);
    if (!raw || raw.length < 5) continue;

    // Filter by active cycle if we have a cycle column
    if (cycleCol >= 0 && currentCycle) {
      var rowCycle = safeText_(data[r][cycleCol]);
      if (rowCycle && rowCycle !== currentCycle) continue;
    }

    // Skip non-answers
    var isEmpty = false;
    for (var ep = 0; ep < emptyPatterns.length; ep++) {
      if (emptyPatterns[ep].test(raw)) { isEmpty = true; break; }
    }
    if (isEmpty) continue;

    // Detect and skip injection attempts (log them instead of silently dropping)
    var isInjection = false;
    for (var ip = 0; ip < injectionPatterns.length; ip++) {
      if (injectionPatterns[ip].test(raw)) {
        Logger.log("getFormComments_: skipped potential injection in row " + (r + 2));
        isInjection = true;
        break;
      }
    }
    if (isInjection) continue;

    // Truncate at 500 chars to prevent prompt bloat from unusually long answers
    var cleaned = raw.length > 500 ? raw.substring(0, 500) + "…" : raw;

    comments.push(cleaned);
  }

  return comments;
}

// ── Commitments (action tracker) ──────────────────────────────────────────────

/**
 * Run once from Apps Script editor: select this function → click Run.
 * Rewrites Action Tracker headers and remaps all existing rows to:
 *   Pulse Opened | Area | Action | Owner | Status | Notes
 */
function migrateActionTrackerNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_ACTIONS);
  if (!sheet) {
    SpreadsheetApp.getUi().alert("Action Tracker sheet not found.");
    return;
  }
  var ui = SpreadsheetApp.getUi();
  var confirm = ui.alert(
    "Rescue Action Tracker Layout",
    "This will rewrite all rows into the canonical 8-column format:\n" +
    "Pulse Opened | Area | Action | Owner | Status | Notes | isPinned | id\n\n" +
    "Existing data will be remapped and a stable id will be generated for each row.\n\nContinue?",
    ui.ButtonSet.OK_CANCEL
  );
  if (confirm !== ui.Button.OK) return;
  rescueActionTrackerSchema_(sheet);
  ui.alert("Done! Action Tracker layout has been rescued.\nA stable id has been assigned to each row.");
}

/**
 * NON-DESTRUCTIVE schema check — safe to call on every read/write.
 * Only adds missing column G (isPinned) or column H (id) headers.
 * Never remaps rows or clears content.
 * For layout rescue on old/broken sheets use menu → Rescue Action Tracker Layout.
 */
function ensureActionTrackerSchema_(sheet) {
  var requiredHeaders = ["Pulse Opened", "Area", "Action", "Owner", "Status", "Notes", "isPinned", "id"];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(requiredHeaders);
    sheet.getRange(1, 1, 1, requiredHeaders.length).setFontWeight("bold");
    return;
  }

  var width = Math.max(sheet.getLastColumn(), 8);
  var headers = sheet.getRange(1, 1, 1, width).getValues()[0] || [];

  // Verify cols A–F are in the expected order before touching anything.
  var coreMatch =
    normalizeLabel(headers[0]) === "pulseopened" &&
    normalizeLabel(headers[1]) === "area" &&
    (normalizeLabel(headers[2]) === "action" || normalizeLabel(headers[2]) === "suggestedaction") &&
    normalizeLabel(headers[3]) === "owner" &&
    normalizeLabel(headers[4]) === "status" &&
    (normalizeLabel(headers[5]) === "notes" || normalizeLabel(headers[5]) === "note");

  if (!coreMatch) {
    // Unknown layout — never auto-migrate. Run menu → Rescue Action Tracker Layout.
    Logger.log("ensureActionTrackerSchema_: unrecognized layout — skipping. Run 'Rescue Action Tracker Layout' from the Pulse Dashboard menu.");
    return;
  }

  // Safely add any missing optional columns (never destructive).
  var hasIsPinned = headers.length > 6 && normalizeLabel(headers[6]) === "ispinned";
  var hasId       = headers.length > 7 && normalizeLabel(headers[7]) === "id";

  if (!hasIsPinned) sheet.getRange(1, 7).setValue("isPinned").setFontWeight("bold");
  if (!hasId)       sheet.getRange(1, 8).setValue("id").setFontWeight("bold");
}

/**
 * DESTRUCTIVE schema rescue — only called from migrateActionTrackerNow (menu).
 * Rewrites the sheet to the canonical 8-column layout, assigning a stable UUID to each row.
 * Never called from getActions, saveAction, or updateAction.
 */
function rescueActionTrackerSchema_(sheet) {
  var requiredHeaders = ["Pulse Opened", "Area", "Action", "Owner", "Status", "Notes", "isPinned", "id"];
  var width = Math.max(sheet.getLastColumn(), 8);
  var headers = sheet.getLastRow() > 0
    ? (sheet.getRange(1, 1, 1, width).getValues()[0] || [])
    : [];

  var idxPulse = -1, idxArea = -1, idxAction = -1, idxOwner = -1;
  var idxStatus = -1, idxNotes = -1, idxConcern = -1, idxId = -1;
  for (var h = 0; h < headers.length; h++) {
    var hn = normalizeLabel(headers[h]);
    if (hn === "pulseopened") idxPulse = h;
    if (hn === "area") idxArea = h;
    if (hn === "action" || hn === "suggestedaction") idxAction = h;
    if (hn === "owner") idxOwner = h;
    if (hn === "status") idxStatus = h;
    if (hn === "notes" || hn === "note") idxNotes = h;
    if (hn === "concern") idxConcern = h;
    if (hn === "id") idxId = h;
  }

  var looksLikeConcernFirst =
    normalizeLabel(headers[0]) === "concern" &&
    normalizeLabel(headers[1]) === "action" &&
    normalizeLabel(headers[2]) === "owner" &&
    normalizeLabel(headers[3]) === "status" &&
    normalizeLabel(headers[4]) === "pulseopened";

  var looksLikeAreaFirstOld =
    normalizeLabel(headers[0]) === "area" &&
    normalizeLabel(headers[1]) === "action" &&
    normalizeLabel(headers[2]) === "owner" &&
    normalizeLabel(headers[3]) === "status" &&
    normalizeLabel(headers[4]) === "pulseopened";

  var rows = [];
  if (sheet.getLastRow() >= 2) {
    rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
  }

  var migrated = [];
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var pulse  = idxPulse  >= 0 ? String(row[idxPulse]  || "").trim() : "";
    var area   = idxArea   >= 0 ? String(row[idxArea]   || "").trim() : "";
    if (!area && idxConcern >= 0) area = String(row[idxConcern] || "").trim();
    var action = idxAction >= 0 ? String(row[idxAction] || "").trim() : "";
    var owner  = idxOwner  >= 0 ? String(row[idxOwner]  || "").trim() : "";
    var status = idxStatus >= 0 ? String(row[idxStatus] || "Planned").trim() : "Planned";
    var notes  = idxNotes  >= 0 ? String(row[idxNotes]  || "").trim() : "";
    // Preserve existing id if present; otherwise generate a new stable UUID.
    var rowId  = (idxId >= 0 && String(row[idxId] || "").trim())
      ? String(row[idxId]).trim()
      : Utilities.getUuid();

    if (looksLikeConcernFirst || looksLikeAreaFirstOld) {
      pulse  = String(row[4] || "").trim();
      area   = String((looksLikeConcernFirst ? row[5] : row[0]) || "").trim();
      action = String(row[1] || "").trim();
      owner  = String(row[2] || "").trim();
      status = String(row[3] || "Planned").trim() || "Planned";
      notes  = String((looksLikeConcernFirst ? row[6] : row[5]) || "").trim();
    }

    if (!action && row.length >= 2) action = String(row[1] || "").trim();
    if (!owner  && row.length >= 3) owner  = String(row[2] || "").trim();
    if ((!status || status === "") && row.length >= 4) status = String(row[3] || "Planned").trim();

    migrated.push([pulse, area, action, owner, status || "Planned", notes, "FALSE", rowId]);
  }

  sheet.clearContents();
  sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]).setFontWeight("bold");
  if (migrated.length > 0) {
    sheet.getRange(2, 1, migrated.length, requiredHeaders.length).setValues(migrated);
  }
}

/**
 * Col A = pulse opened, B = area, C = commitment/action,
 * D = owner, E = status, F = notes, G = isPinned
 */
function getActions(ss) {
  var sheet = ss.getSheetByName(SHEET_ACTIONS);
  if (!sheet) return [];

  ensureActionTrackerSchema_(sheet);

  var data = sheet.getDataRange().getValues();
  var actions = [];

  for (var i = 1; i < data.length; i++) {
    var suggestedAction = String(data[i][2] || "").trim();
    if (!suggestedAction) continue;

    var action = {
      area:            String(data[i][1] || "").trim(),
      suggestedAction: suggestedAction,
      owner:           String(data[i][3] || "").trim(),
      status:          String(data[i][4] || "").trim() || "Planned",
      isPinned:        (data[i].length > 6) ? (String(data[i][6] || "FALSE").trim() === "TRUE") : false,
    };
    if (data[i].length > 0 && String(data[i][0]).trim()) action.pulseOpened = String(data[i][0]).trim();
    if (data[i].length > 5 && String(data[i][5]).trim()) action.notes = String(data[i][5]).trim();
    if (data[i].length > 7 && String(data[i][7]).trim()) action.id = String(data[i][7]).trim();

    // Skip rows soft-deleted via the dashboard UI
    if (action.status === "Deleted") continue;

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
  var lock = null;
  try {
    var payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        return ContentService
          .createTextOutput(JSON.stringify({ error: true, message: "Invalid JSON body" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    // ── Shared-secret auth ────────────────────────────────────────────────────
    if (!isAuthorized_(payload.secret)) {
      return unauthorizedResponse_();
    }

    var action = String(payload.action || "").trim();

    // ── Document lock (serialise all mutations) ─────────────────────────────────
    lock = LockService.getDocumentLock();
    if (!lock.tryLock(15000)) {
      lock = null;
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, message: "Service busy, please try again in a moment" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

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
    
    if (action === "saveAction") {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = getOrCreateSheet_(ss, SHEET_ACTIONS);
      ensureActionTrackerSchema_(sheet);
      var areaVal = String(payload.area || "").trim();
      var statusVal = String(payload.status || "Planned").trim();
      // Reject the soft-delete sentinel on create — clients must use deleteAction.
      var ALLOWED_CREATE_STATUS = { "Planned": true, "In Progress": true, "Completed": true };
      if (!ALLOWED_CREATE_STATUS[statusVal]) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, message: "Invalid status" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      sheet.appendRow([
        String(payload.pulseOpened || "").trim(),           // col A: pulse opened
        areaVal,                                             // col B: area (single source of truth)
        String(payload.suggestedAction || "").trim(),       // col C: action
        String(payload.owner || "").trim(),                 // col D: owner
        statusVal,                                           // col E: status
        String(payload.notes || "").trim(),                 // col F: notes
        payload.isPinned ? "TRUE" : "FALSE",                // col G: isPinned
        Utilities.getUuid(),                                // col H: stable row id
      ]);
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "updateAction" || action === "deleteAction") {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(SHEET_ACTIONS);
      if (!sheet || sheet.getLastRow() < 2) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, message: "Action Tracker sheet not found or empty" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      ensureActionTrackerSchema_(sheet);
      var keyId       = String(payload.id || "").trim();
      var keyAction   = String(payload.originalSuggestedAction || payload.suggestedAction || "").trim();
      var keyOwner    = String(payload.originalOwner || payload.owner || "").trim();
      var keyArea     = String(payload.originalArea || payload.area || "").trim();
      var data = sheet.getDataRange().getValues();
      var targetRow = -1;
      // Prefer stable id match (col H, index 7) — avoids content-collision bugs.
      if (keyId) {
        for (var ri = 1; ri < data.length; ri++) {
          if (data[ri].length > 7 && String(data[ri][7] || "").trim() === keyId) {
            targetRow = ri + 1;
            break;
          }
        }
      }
      // Fallback: content-based match for rows created before id column was added.
      if (targetRow < 0) {
        for (var ri2 = 1; ri2 < data.length; ri2++) {
          var rowAction = String(data[ri2][2] || "").trim();
          var rowOwner  = String(data[ri2][3] || "").trim();
          var rowArea   = String(data[ri2][1] || "").trim();
          if (rowAction === keyAction && rowOwner === keyOwner && rowArea === keyArea) {
            targetRow = ri2 + 1;
            break;
          }
        }
      }
      if (targetRow < 0) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, message: "Action not found" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (action === "deleteAction") {
        sheet.getRange(targetRow, 5).setValue("Deleted");
      } else {
        // Reject "Deleted" on update — only deleteAction may set that sentinel.
        var newStatus = String(payload.status || "Planned").trim();
        var ALLOWED_UPDATE_STATUS = { "Planned": true, "In Progress": true, "Completed": true };
        if (!ALLOWED_UPDATE_STATUS[newStatus]) {
          return ContentService
            .createTextOutput(JSON.stringify({ ok: false, message: "Invalid status" }))
            .setMimeType(ContentService.MimeType.JSON);
        }
        if (payload.pulseOpened !== undefined) sheet.getRange(targetRow, 1).setValue(String(payload.pulseOpened || "").trim()); // col A: pulse opened
        if (payload.area !== undefined) sheet.getRange(targetRow, 2).setValue(String(payload.area || "").trim()); // col B: area
        if (payload.suggestedAction !== undefined) sheet.getRange(targetRow, 3).setValue(String(payload.suggestedAction || "").trim()); // col C: action
        if (payload.owner !== undefined) sheet.getRange(targetRow, 4).setValue(String(payload.owner || "").trim()); // col D: owner
        sheet.getRange(targetRow, 5).setValue(newStatus); // col E: status
        if (payload.notes !== undefined) sheet.getRange(targetRow, 6).setValue(String(payload.notes || "").trim()); // col F: notes
        if (payload.isPinned !== undefined) sheet.getRange(targetRow, 7).setValue(payload.isPinned ? "TRUE" : "FALSE"); // col G: isPinned
      }
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ error: true, message: "Unknown action" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: true, message: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    if (lock) lock.releaseLock();
  }
}
