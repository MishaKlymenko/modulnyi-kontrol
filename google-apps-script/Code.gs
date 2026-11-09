const SHEET_NAME = "Відповіді";
const SECRET_PROPERTY = "SUBMISSION_SHARED_SECRET";
const HEADERS = [
  "ID спроби",
  "Дата завершення (UTC)",
  "ПІБ",
  "Варіант",
  "Причина завершення",
  "Попереджень про втрату фокусу",
  "Журнал втрати фокусу",
  "Теорія 1",
  "Теорія 2",
  "Теорія 3",
  "Теорія 4",
  "Теорія 5",
  "Практичне 1",
  "Практичне 2"
];

function setupSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("Спочатку прив'яжіть цей Apps Script до таблиці Google.");

  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
  sheet.autoResizeColumns(1, HEADERS.length);
}

function doPost(event) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return jsonResponse({ saved: false, error: "busy" });

  try {
    const body = JSON.parse(event.postData.contents);
    const expectedSecret = PropertiesService.getScriptProperties().getProperty(SECRET_PROPERTY);
    if (!expectedSecret || !constantTimeEquals(String(body.secret || ""), expectedSecret)) {
      return jsonResponse({ saved: false, error: "unauthorized" });
    }
    if (!isValidSubmission(body)) return jsonResponse({ saved: false, error: "invalid" });

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) return jsonResponse({ saved: false, error: "spreadsheet_not_found" });
    let sheet = spreadsheet.getSheetByName(SHEET_NAME);
    if (!sheet) {
      setupSheet();
      sheet = spreadsheet.getSheetByName(SHEET_NAME);
    }

    const row = [
      body.id,
      body.finished,
      safeCell(body.name.trim().replace(/\s+/g, " ")),
      body.variant,
      safeCell(body.reason),
      body.focusWarnings,
      safeCell(JSON.stringify(body.focusLog)),
      safeCell(body.answers.t0 || ""),
      safeCell(body.answers.t1 || ""),
      safeCell(body.answers.t2 || ""),
      safeCell(body.answers.t3 || ""),
      safeCell(body.answers.t4 || ""),
      safeCell(body.answers.p0 || ""),
      safeCell(body.answers.p1 || "")
    ];

    const match = sheet.getRange("A:A").createTextFinder(body.id).matchEntireCell(true).findNext();
    const rowNumber = match ? match.getRow() : sheet.getLastRow() + 1;
    sheet.getRange(rowNumber, 1, 1, HEADERS.length).setNumberFormat("@");
    sheet.getRange(rowNumber, 1, 1, HEADERS.length).setValues([row]);
    return jsonResponse({ saved: true });
  } catch (error) {
    console.error("Could not save submission:", error);
    return jsonResponse({ saved: false, error: "save_failed" });
  } finally {
    lock.releaseLock();
  }
}

function isValidSubmission(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if (typeof body.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id)) return false;
  if (typeof body.name !== "string" || body.name.trim().length < 3 || body.name.length > 120) return false;
  if (!Number.isInteger(body.variant) || body.variant < 1 || body.variant > 10) return false;
  if (typeof body.reason !== "string" || body.reason.length > 120) return false;
  if (typeof body.finished !== "string" || Number.isNaN(Date.parse(body.finished))) return false;
  if (!Number.isInteger(body.focusWarnings) || body.focusWarnings < 0 || body.focusWarnings > 100) return false;
  if (!Array.isArray(body.focusLog) || body.focusLog.length > 100) return false;
  if (!body.focusLog.every(entry => entry && typeof entry.at === "string" && entry.at.length <= 40 && Number.isInteger(entry.seconds) && entry.seconds >= 0 && entry.seconds <= 10)) return false;
  if (!body.answers || typeof body.answers !== "object" || Array.isArray(body.answers)) return false;
  const allowedKeys = ["t0", "t1", "t2", "t3", "t4", "p0", "p1"];
  return Object.keys(body.answers).every(key => allowedKeys.includes(key) && typeof body.answers[key] === "string" && body.answers[key].length <= 10000);
}

function safeCell(value) {
  const text = String(value);
  return /^[\s]*[=+\-@]/.test(text) ? "'" + text : text;
}

function constantTimeEquals(actual, expected) {
  let difference = actual.length ^ expected.length;
  const length = Math.max(actual.length, expected.length);
  for (let i = 0; i < length; i++) {
    difference |= (actual.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return difference === 0;
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
