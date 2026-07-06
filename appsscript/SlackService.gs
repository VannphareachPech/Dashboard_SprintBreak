/**
 * Sends leadership summary to Slack if conditions are met.
 * 
 * Checks:
 *   1. sendApproved flag is TRUE in Settings
 *   2. Response count meets minimum threshold
 *   3. Data hasn't already been sent (hash dedup)
 * 
 * Sends via Slack webhook (supports both Incoming Webhooks and Workflow triggers).
 */
function sendLeadershipSummaryToSlack() {
  const settings = readSettings();

  if (!settings.sendApproved) {
    Logger.log("Skipped: Send to Slack Approved is FALSE in Settings tab.");
    return;
  }

  const webhookUrl = PropertiesService.getScriptProperties().getProperty(PULSE_CONFIG.WEBHOOK_PROPERTY_KEY);
  if (!webhookUrl) throw new Error("Missing SLACK_WEBHOOK_URL in Script Properties.");
  const dashboardUrl = PropertiesService.getScriptProperties().getProperty(PULSE_CONFIG.DASHBOARD_URL_PROPERTY_KEY);

  const rows = getSlackScoreRows_();
  const metrics = getSlackKeyMetrics_(rows, settings);
  const classified = classifySlackRows_(rows);

  const totalResponses = parseInt(String(metrics.totalResponses || "0").replace(/\D/g, ""), 10);
  const minRequired = settings.minResponses || PULSE_CONFIG.MIN_RESPONSES_DEFAULT;

  if (totalResponses < minRequired) {
    Logger.log("Skipped: only " + totalResponses + " responses, need " + minRequired + ".");
    resetApprovalFlag_();
    return;
  }

  const props = PropertiesService.getScriptProperties();
  const lastHash = props.getProperty("SLACK_LAST_HASH") || "";
  const cycle = settings.currentCycle || "Unknown Cycle";

  // Hard guard: never post more than once per cycle regardless of re-runs or data changes.
  if (typeof isSlackSentForCycle_ === "function" && isSlackSentForCycle_(cycle)) {
    Logger.log("Skipped: Slack already sent for cycle '" + cycle + "'. Use closePulse/resetSlackFlag to re-enable.");
    return;
  }

  const extremes = computeExtremes_(rows);
  const lowestArea  = metrics.lowestArea  || extremes.lowestArea  || "Not available";
  const highestArea = metrics.highestArea || extremes.highestArea || "Not available";

  const focus = buildSlackFocus_(lowestArea, classified);
  const now = formatNow_(PULSE_CONFIG.DATE_FORMAT);

  // Hash only key fields so same-day re-runs with same data are skipped
  const currentHash = hashText_(cycle + String(totalResponses) + lowestArea + highestArea + now.substring(0, 10));

  if (lastHash === currentHash) {
    Logger.log("Skipped: no change since last send.");
    resetApprovalFlag_();
    return;
  }

  postToSlack_(webhookUrl, {
    cycle: cycle,
    totalResponses: totalResponses,
    highestArea: highestArea,
    lowestArea: lowestArea,
    rows: rows,
    focusText: focus,
    generatedAt: now,
    dashboardUrl: dashboardUrl
  });

  // Must persist AFTER successful send to avoid stuck dedupe
  props.setProperty("SLACK_LAST_HASH", currentHash);
  props.setProperty("SLACK_LAST_SENT", now);
  // Mark cycle as sent so no future pipeline run can post again for this cycle.
  if (typeof markSlackSentForCycle_ === "function") markSlackSentForCycle_(cycle);
  resetApprovalFlag_();

  Logger.log("Sent to Slack for cycle: " + cycle);
}

function getSlackScoreRows_() {
  // Prefer shared helper when available.
  if (typeof readScoreRows === "function") {
    try {
      return readScoreRows();
    } catch (e) {
      Logger.log("Slack fallback: readScoreRows failed: " + e.message);
    }
  }

  // Local fallback: read canonical area scores from Summary sheet.
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PULSE_CONFIG.SUMMARY_SHEET);
  if (!sheet || sheet.getLastRow() < PULSE_CONFIG.SCORE_DATA_START_ROW) return [];

  var rowCount = sheet.getLastRow() - PULSE_CONFIG.SCORE_DATA_START_ROW + 1;
  var values = sheet
    .getRange(PULSE_CONFIG.SCORE_DATA_START_ROW, PULSE_CONFIG.AREA_COL, rowCount, PULSE_CONFIG.STATUS_COL)
    .getDisplayValues();

  var validAreas = (typeof AREA_NAMES !== "undefined" && AREA_NAMES.length) ? AREA_NAMES : [];
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var area = safeText_(values[i][0]);
    if (!area) continue;
    if (validAreas.length && validAreas.indexOf(area) === -1) continue;

    var score = parseScore_(values[i][1]);
    var status = normalizeStatus_(values[i][2]) || inferStatusFromScore_(score);
    rows.push({ area: area, score: score, status: status });
  }
  return rows;
}

function getSlackKeyMetrics_(rows, settings) {
  // Prefer shared helper when available.
  if (typeof readKeyMetrics === "function") {
    try {
      return readKeyMetrics();
    } catch (e) {
      Logger.log("Slack fallback: readKeyMetrics failed: " + e.message);
    }
  }

  var result = { lowestArea: "", highestArea: "", totalResponses: 0 };
  var extremes = computeExtremes_(rows || []);
  result.lowestArea = extremes.lowestArea || "";
  result.highestArea = extremes.highestArea || "";

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var trends = typeof getTrends === "function" ? getTrends(ss) : [];
  result.totalResponses = String(getActiveCycleResponseCount_(ss, settings, trends));
  return result;
}

function classifySlackRows_(rows) {
  // Prefer shared helper when available.
  if (typeof classifyRows === "function") {
    try {
      return classifyRows(rows || []);
    } catch (e) {
      Logger.log("Slack fallback: classifyRows failed: " + e.message);
    }
  }

  var positive = [], mixed = [], concern = [];
  (rows || []).forEach(function(row) {
    var label = row.area + " (" + (isFinite(row.score) ? row.score.toFixed(2) : "n/a") + ")";
    if (row.status === "Concern") concern.push(label);
    else if (row.status === "Mixed") mixed.push(label);
    else positive.push(label);
  });
  return { positiveAreas: positive, mixedAreas: mixed, concernAreas: concern };
}

function buildSlackFocus_(lowestArea, classified) {
  if (classified.concernAreas.length > 0) {
    return "Prioritise: " + lowestArea + ". Concern areas need follow-up.";
  }
  if (classified.mixedAreas.length > 0) {
    return "Monitor: " + lowestArea + ". Consider small alignment actions.";
  }
  return "Overall positive. Keep monitoring: " + lowestArea + ".";
}

function postToSlack_(webhookUrl, data) {
  const isWorkflowWebhook = String(webhookUrl).indexOf("/triggers/") > -1;
  const plainText = buildPlainSlackText_(data);

  if (isWorkflowWebhook) {
    // Workflow webhook: send both message_Text (capital T) and text as fallback
    return sendSlackJson_(webhookUrl, { message_Text: plainText, text: plainText });
  }

  // Direct Incoming Webhook: try Block Kit first, fall back to plain text
  const blocksPayload = buildBlockKitPayload_(data, plainText);
  const firstTry = sendSlackJson_(webhookUrl, blocksPayload, true);

  if (!firstTry.ok) {
    Logger.log("Block Kit failed (" + firstTry.code + "), falling back to plain text.");
    const fallback = sendSlackJson_(webhookUrl, { text: plainText }, true);
    if (!fallback.ok) {
      throw new Error("Slack post failed. Block Kit and plain text both failed. Last error: " + fallback.errorBody);
    }
  }
}

function buildBlockKitPayload_(data, plainText) {
  const scoreLines = (data.rows || []).map(function(r) {
    const emoji = r.status === "Positive" ? "🟢" : (r.status === "Mixed" ? "🟡" : "🔴");
    const scoreLabel = isFinite(r.score) ? Number(r.score).toFixed(2) : "n/a";
    return emoji + " " + safeMrkdwn_(r.area) + ": " + scoreLabel + " (" + safeMrkdwn_(r.status || "Mixed") + ")";
  }).join("\n");

  const scoreBlockText = truncateForSlack_(scoreLines || "No score rows available.", 2800);
  const focusText = truncateForSlack_(safeMrkdwn_(data.focusText || "No focus text available."), 2800);
  const dashboardLine = buildDashboardLine_(data.dashboardUrl, true);

  return {
    text: plainText,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "B2CSS Team Engagement Survey - " + (data.cycle || "Current Cycle")
        }
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: "*Total Responses:*\n" + safeMrkdwn_(String(data.totalResponses || "Not available")) },
          { type: "mrkdwn", text: "*Highest Area:*\n" + safeMrkdwn_(data.highestArea || "Not available") },
          { type: "mrkdwn", text: "*Lowest Area:*\n" + safeMrkdwn_(data.lowestArea || "Not available") }
        ]
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Score by Area*\n" + scoreBlockText }
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Leadership Focus*\n" + focusText }
      },
        {
          type: "section",
          text: { type: "mrkdwn", text: dashboardLine }
        },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Generated: " + safeMrkdwn_(data.generatedAt || "") + ". Automated summary - please review before acting."
          }
        ]
      }
    ]
  };
}

function buildPlainSlackText_(data) {
  const scoreLines = (data.rows || []).map(function(r) {
    const emoji = r.status === "Positive" ? "🟢" : (r.status === "Mixed" ? "🟡" : "🔴");
    const scoreLabel = isFinite(r.score) ? Number(r.score).toFixed(2) : "n/a";
    return emoji + " " + r.area + ": " + scoreLabel + " (" + (r.status || "Mixed") + ")";
  }).join("\n");

  var text =
    "*B2CSS Team Engagement Survey - " + (data.cycle || "Current Cycle") + "*\n\n" +
    "*Total Responses:* " + (data.totalResponses || "Not available") + "\n" +
    "*Highest Area:* " + (data.highestArea || "Not available") + "\n" +
    "*Lowest Area:* " + (data.lowestArea || "Not available") + "\n\n" +
    "*Score by Area:*\n" + (scoreLines || "No score rows available.") + "\n\n" +
    "*Leadership Focus:*\n" + (data.focusText || "No focus text available.") + "\n\n" +
    buildDashboardLine_(data.dashboardUrl, false) + "\n\n" +
    "_Generated: " + (data.generatedAt || "") + ". Automated summary - review before acting._";

  return truncateForSlack_(text, 3500);
}

function buildDashboardLine_(dashboardUrl, asMrkdwn) {
  var url = String(dashboardUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return asMrkdwn ? "*Dashboard:* Dashboard link not configured." : "Dashboard: Dashboard link not configured.";
  }

  if (asMrkdwn) {
    return "*Dashboard:* <" + safeMrkdwn_(url) + "|Open Latest Dashboard>";
  }

  return "Dashboard: " + url;
}

function sendSlackJson_(webhookUrl, payloadObj, noThrow) {
  var res = UrlFetchApp.fetch(webhookUrl, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payloadObj),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  var ok = code >= 200 && code < 300;

  Logger.log("Slack HTTP: " + code + " | Body: " + body);

  if (!ok && !noThrow) {
    throw new Error("Slack post failed. HTTP " + code + ": " + body);
  }

  return { ok: ok, code: code, errorBody: body };
}

function truncateForSlack_(text, maxLen) {
  var s = String(text || "");
  if (s.length <= maxLen) return s;
  return s.substring(0, maxLen - 18) + "\n[truncated]";
}

function safeMrkdwn_(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function resetApprovalFlag_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PULSE_CONFIG.SETTINGS_SHEET);
  if (!sheet) return;
  const values = sheet.getDataRange().getValues();
  for (let r = 0; r < values.length; r++) {
    if (normalizeText_(values[r][0]) === "send to slack approved") {
      sheet.getRange(r + 1, 2).setValue("FALSE");
      return;
    }
  }
}

function computeExtremes_(rows) {
  const valid = rows.filter(function(r) { return isFinite(r.score); });
  if (!valid.length) return { lowestArea: "", highestArea: "" };
  const lowest  = valid.reduce(function(a, b) { return b.score < a.score ? b : a; });
  const highest = valid.reduce(function(a, b) { return b.score > a.score ? b : a; });
  return {
    lowestArea:  lowest.area  + " (" + lowest.score.toFixed(2)  + ")",
    highestArea: highest.area + " (" + highest.score.toFixed(2) + ")"
  };
}
