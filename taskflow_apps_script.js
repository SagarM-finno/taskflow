// ╔══════════════════════════════════════════════════════════════════╗
// ║  TASKFLOW — Apps Script Web API                                ║
// ║  With: Activity Log, User Tracking, Cliq Notifications         ║
// ╚══════════════════════════════════════════════════════════════════╝
//
// SETUP:
// 1. Paste this into Extensions → Apps Script
// 2. Save → Deploy → New deployment → Web app
//    Execute as: Me • Access: Anyone → Deploy → Copy URL
// 3. Run "setup" once for auto-reminders
// 4. Run "sendTestMessage" to verify Cliq

function doGet(e) {
  var action = e.parameter.action;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    if (action === "getAll") {
      return jr({ tasks: getTasks(ss), members: getMembers(ss) });
    }
    if (action === "getLog") {
      return jr(getLog(ss, parseInt(e.parameter.limit) || 50));
    }
    return jr({ error: "Unknown action" });
  } catch (err) { return jr({ error: err.message }); }
}

function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data;
  try { data = JSON.parse(e.postData.contents); } catch (err) { return jr({ error: "Invalid JSON" }); }
  try {
    var action = data.action;
    var user = data.user || "Unknown";
    if (action === "addTask") return jr(addTask(ss, data, user));
    if (action === "updateStatus") return jr(updateStatus(ss, data, user));
    if (action === "updateTask") return jr(updateTask(ss, data, user));
    return jr({ error: "Unknown action" });
  } catch (err) { return jr({ error: err.message }); }
}

function jr(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// ─── ENSURE SHEETS EXIST ───

function ensureLogSheet(ss) {
  var sheet = ss.getSheetByName("Activity Log");
  if (!sheet) {
    sheet = ss.insertSheet("Activity Log");
    sheet.getRange("A1:E1").setValues([["Timestamp", "User", "Action", "Task", "Details"]]);
    sheet.getRange("A1:E1").setFontWeight("bold").setBackground("#5B8DEF").setFontColor("#FFFFFF");
    sheet.setColumnWidth(1, 180);
    sheet.setColumnWidth(2, 120);
    sheet.setColumnWidth(3, 140);
    sheet.setColumnWidth(4, 200);
    sheet.setColumnWidth(5, 300);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function logActivity(ss, user, action, task, details) {
  var sheet = ensureLogSheet(ss);
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM dd, yyyy hh:mm a");
  sheet.insertRowAfter(1);
  sheet.getRange(2, 1, 1, 5).setValues([[timestamp, user, action, task, details]]);
}

// ─── DATA ───

function getTasks(ss) {
  var sheet = ss.getSheetByName("Tasks");
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0].map(function(h) { return String(h).trim().toLowerCase(); });
  var tasks = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var get = function(name) { var idx = headers.indexOf(name); return idx >= 0 && row[idx] != null ? String(row[idx]).trim() : ""; };
    var title = get("title"); if (!title) continue;
    var due = get("due date"), rem = get("reminder time");
    var dueIdx = headers.indexOf("due date"), remIdx = headers.indexOf("reminder time");
    if (row[dueIdx] instanceof Date) due = Utilities.formatDate(row[dueIdx], Session.getScriptTimeZone(), "yyyy-MM-dd");
    if (row[remIdx] instanceof Date) rem = Utilities.formatDate(row[remIdx], Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm");
    tasks.push({ ri: r + 1, id: get("task id"), title: title, desc: get("description"), to: get("assigned to"), by: get("assigned by"), pri: get("priority") || "Medium", st: get("status") || "To Do", due: due, rem: rem, sent: get("reminder sent") });
  }
  return tasks;
}

function getMembers(ss) {
  var sheet = ss.getSheetByName("Team");
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var members = [], colors = ["#E8B931","#5B8DEF","#EF6B6B","#6BCB77","#C97BDB","#FF8C42","#36CFC9","#F759AB"];
  for (var r = 1; r < data.length; r++) {
    var name = String(data[r][0] || "").trim(); if (!name) continue;
    members.push({ name: name, avatar: String(data[r][1] || "👤").trim(), color: String(data[r][2] || colors[r % colors.length]).trim() });
  }
  return members;
}

function getLog(ss, limit) {
  var sheet = ss.getSheetByName("Activity Log");
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var entries = [];
  for (var r = 1; r < Math.min(data.length, limit + 1); r++) {
    entries.push({ time: String(data[r][0]), user: String(data[r][1]), action: String(data[r][2]), task: String(data[r][3]), details: String(data[r][4]) });
  }
  return entries;
}

// ─── ACTIONS ───

function addTask(ss, data, user) {
  var sheet = ss.getSheetByName("Tasks");
  if (!sheet) throw new Error("Tasks sheet not found");
  var taskId = "TASK" + Math.floor(Math.random() * 9000 + 1000);
  sheet.appendRow([taskId, data.title || "", data.desc || "", data.to || "", data.by || "", data.pri || "Medium", "To Do", data.due || "", data.rem || "", new Date().toISOString(), "No"]);

  // Log
  logActivity(ss, user, "Created task", data.title, "Assigned to " + data.to + " • Priority: " + data.pri + (data.due ? " • Due: " + data.due : ""));

  // Cliq
  var pe = data.pri === "High" ? "🔴" : data.pri === "Low" ? "🟢" : "🟡";
  sendCliq(ss, "📋 *New Task* by *" + user + "*\n\n*" + data.title + "*" + (data.desc ? "\n" + data.desc : "") + "\n\n👤 Assigned to: " + data.to + "\n" + pe + " Priority: " + data.pri + (data.due ? "\n📅 Due: " + data.due : ""));
  return { ok: true, id: taskId };
}

function updateStatus(ss, data, user) {
  var sheet = ss.getSheetByName("Tasks");
  if (!sheet) throw new Error("Tasks sheet not found");
  var ri = data.ri, newSt = data.status;
  if (!ri || !newSt) throw new Error("Missing data");

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var stCol = -1;
  for (var i = 0; i < headers.length; i++) { if (String(headers[i]).trim().toLowerCase() === "status") { stCol = i + 1; break; } }
  if (stCol === -1) throw new Error("Status column not found");

  var oldTitle = String(sheet.getRange(ri, 2).getValue());
  var oldSt = String(sheet.getRange(ri, stCol).getValue());
  var assignee = String(sheet.getRange(ri, 4).getValue());
  sheet.getRange(ri, stCol).setValue(newSt);

  // Log
  logActivity(ss, user, "Status changed", oldTitle, oldSt + " → " + newSt);

  // Cliq
  var emoji = newSt === "Done" ? "✅" : newSt === "In Progress" ? "▶️" : "↩️";
  sendCliq(ss, emoji + " *" + oldTitle + "* → " + newSt + "\nChanged by *" + user + "* • 👤 " + assignee);
  return { ok: true };
}

function updateTask(ss, data, user) {
  var sheet = ss.getSheetByName("Tasks");
  if (!sheet) throw new Error("Tasks sheet not found");
  var ri = data.ri; if (!ri) throw new Error("Missing row");

  var oldRow = sheet.getRange(ri, 1, 1, 11).getValues()[0];
  var oldTitle = String(oldRow[1] || "").trim();
  var oldTo = String(oldRow[3] || "").trim();
  var oldSt = String(oldRow[6] || "").trim();
  var oldPri = String(oldRow[5] || "").trim();

  var vals = [data.title || "", data.desc || "", data.to || "", data.by || "", data.pri || "Medium", data.st || "To Do", data.due || "", data.rem || ""];
  sheet.getRange(ri, 2, 1, 8).setValues([vals]);

  // Build change details for log
  var changes = [];
  if (data.title !== oldTitle) changes.push("Title: " + oldTitle + " → " + data.title);
  if (data.to !== oldTo) changes.push("Assignee: " + oldTo + " → " + data.to);
  if (data.st !== oldSt) changes.push("Status: " + oldSt + " → " + data.st);
  if (data.pri !== oldPri) changes.push("Priority: " + oldPri + " → " + data.pri);
  var detail = changes.length > 0 ? changes.join(" • ") : "Minor edits";

  logActivity(ss, user, "Edited task", data.title, detail);

  // Cliq notifications for important changes
  if (data.to && data.to !== oldTo) {
    sendCliq(ss, "🔄 *Task Reassigned* by *" + user + "*\n\n*" + data.title + "*\n👤 Now: " + data.to + " (was: " + oldTo + ")");
  }
  if (data.st && data.st !== oldSt) {
    var emoji = data.st === "Done" ? "✅" : data.st === "In Progress" ? "▶️" : "↩️";
    sendCliq(ss, emoji + " *" + data.title + "* → " + data.st + "\nChanged by *" + user + "*");
  }
  return { ok: true };
}

// ─── ZOHO CLIQ ───

function sendCliq(ss, msg) {
  var url = getWebhookUrl(ss); if (!url) return false;
  try {
    var r = UrlFetchApp.fetch(url, { method: "post", contentType: "application/json", payload: JSON.stringify({ text: msg, card: { title: "⏰ Taskflow", theme: "modern-inline" } }), muteHttpExceptions: true });
    return r.getResponseCode() >= 200 && r.getResponseCode() < 300;
  } catch (e) { Logger.log("Cliq error: " + e.message); return false; }
}

function getWebhookUrl(ss) {
  var sheet = ss.getSheetByName("Settings"); if (!sheet) return null;
  var data = sheet.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]).trim().toLowerCase().indexOf("webhook") >= 0) {
      var url = String(data[r][1]).trim();
      if (url && url.indexOf("http") === 0) return url;
    }
  }
  return null;
}

// ─── REMINDERS ───

function setup() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("checkReminders").timeBased().everyMinutes(5).create();
  ensureLogSheet(SpreadsheetApp.getActiveSpreadsheet());
  Logger.log("✅ Setup complete!");
  checkReminders();
}

function stopReminders() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  Logger.log("🛑 Stopped.");
}

function checkReminders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Tasks"); if (!sheet) return;
  var data = sheet.getDataRange().getValues(), headers = data[0], now = new Date(), sent = 0;
  var cols = {};
  for (var h = 0; h < headers.length; h++) {
    var hdr = String(headers[h]).trim().toLowerCase();
    if (hdr === "title") cols.title = h; else if (hdr === "assigned to") cols.to = h;
    else if (hdr === "assigned by") cols.by = h; else if (hdr === "priority") cols.pri = h;
    else if (hdr === "status") cols.st = h; else if (hdr === "due date") cols.due = h;
    else if (hdr === "reminder time") cols.rem = h; else if (hdr === "reminder sent") cols.sent = h;
  }
  for (var r = 1; r < data.length; r++) {
    var row = data[r]; if (!row[cols.rem]) continue;
    if (String(row[cols.sent] || "").trim().toLowerCase() === "yes") continue;
    if (String(row[cols.st] || "").trim().toLowerCase() === "done") continue;
    var rt = row[cols.rem] instanceof Date ? row[cols.rem] : new Date(String(row[cols.rem]));
    if (isNaN(rt.getTime())) continue;
    if (rt <= now) {
      var title = row[cols.title] || "Untitled";
      var pe = String(row[cols.pri]) === "High" ? "🔴" : String(row[cols.pri]) === "Low" ? "🟢" : "🟡";
      var ds = ""; if (row[cols.due]) ds = row[cols.due] instanceof Date ? Utilities.formatDate(row[cols.due], Session.getScriptTimeZone(), "MMM dd, yyyy") : String(row[cols.due]);
      var ok = sendCliq(ss, "⏰ *Task Reminder*\n\n*" + title + "*\n\n" + pe + " " + row[cols.pri] + "\n👤 " + row[cols.to] + "\n📋 By: " + row[cols.by] + (ds ? "\n📅 Due: " + ds : ""));
      if (ok) { sheet.getRange(r + 1, cols.sent + 1).setValue("Yes"); sent++;
        logActivity(ss, "System", "Reminder sent", title, "Sent to Cliq • Assigned to " + row[cols.to]);
      }
    }
  }
  Logger.log(sent > 0 ? "📨 " + sent + " reminder(s)" : "ℹ️ No reminders due");
}

function sendTestMessage() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ok = sendCliq(ss, "🧪 *Test from Taskflow*\n\nCliq integration working! 🎉");
  SpreadsheetApp.getUi().alert(ok ? "✅ Check Cliq!" : "❌ Failed. Check webhook URL in Settings.");
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu("⏰ Taskflow")
    .addItem("▶️ Check Reminders", "checkReminders")
    .addItem("🧪 Test Cliq", "sendTestMessage")
    .addSeparator()
    .addItem("⚙️ Setup", "setup")
    .addItem("🛑 Stop", "stopReminders")
    .addToUi();
}
