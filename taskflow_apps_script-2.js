// ╔══════════════════════════════════════════════════════════════╗
// ║  TASKFLOW — Google Apps Script                              ║
// ║  Handles: Reminders + Task Assignment Notifications         ║
// ╚══════════════════════════════════════════════════════════════╝
//
// SETUP:
// 1. Open Google Sheet → Extensions → Apps Script
// 2. Delete existing code, paste this entire file
// 3. Click Save → select "setup" → click ▶️ Run
// 4. Approve permissions when prompted
// 5. Done! Checks every 5 minutes for reminders + notifications.

function setup() {
  // Remove old triggers
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "checkReminders" || t.getHandlerFunction() === "processAll") {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  // Create trigger that runs every 5 minutes
  ScriptApp.newTrigger("processAll").timeBased().everyMinutes(5).create();
  
  // Create the Notifications sheet if it doesn't exist
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var notifSheet = ss.getSheetByName("Notifications");
  if (!notifSheet) {
    notifSheet = ss.insertSheet("Notifications");
    notifSheet.getRange("A1:C1").setValues([["Timestamp", "Message", "Status"]]);
    notifSheet.getRange("A1:C1").setFontWeight("bold");
    notifSheet.setColumnWidth(1, 180);
    notifSheet.setColumnWidth(2, 500);
    notifSheet.setColumnWidth(3, 100);
  }
  
  Logger.log("✅ Setup complete! Runs every 5 minutes.");
  Logger.log("💡 Run 'sendTestMessage' to verify Cliq connection.");
  processAll();
}

function stopReminders() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "processAll" || t.getHandlerFunction() === "checkReminders") {
      ScriptApp.deleteTrigger(t);
    }
  });
  Logger.log("🛑 Stopped all triggers.");
}

/**
 * Main function: processes both reminders and notification queue.
 */
function processAll() {
  checkReminders();
  processNotifications();
}

// ═══════════════════════════════════════
// PART 1: REMINDER CHECKER
// ═══════════════════════════════════════

function checkReminders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Tasks");
  if (!sheet) return;
  
  var webhookUrl = getWebhookUrl(ss);
  if (!webhookUrl) { Logger.log("⚠️ No webhook URL."); return; }
  
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var now = new Date();
  var sent = 0;
  
  var cols = {};
  for (var h = 0; h < headers.length; h++) {
    var hdr = String(headers[h]).trim().toLowerCase();
    if (hdr === "task id") cols.id = h;
    else if (hdr === "title") cols.title = h;
    else if (hdr === "description") cols.desc = h;
    else if (hdr === "assigned to") cols.to = h;
    else if (hdr === "assigned by") cols.by = h;
    else if (hdr === "priority") cols.pri = h;
    else if (hdr === "status") cols.st = h;
    else if (hdr === "due date") cols.due = h;
    else if (hdr === "reminder time") cols.rem = h;
    else if (hdr === "reminder sent") cols.sent = h;
  }
  
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var remVal = row[cols.rem];
    if (!remVal) continue;
    if (String(row[cols.sent] || "").trim().toLowerCase() === "yes") continue;
    if (String(row[cols.st] || "").trim().toLowerCase() === "done") continue;
    
    var remTime = remVal instanceof Date ? remVal : new Date(String(remVal));
    if (isNaN(remTime.getTime())) continue;
    
    if (remTime <= now) {
      var title = row[cols.title] || "Untitled";
      var assignee = row[cols.to] || "Unassigned";
      var assigner = row[cols.by] || "Unknown";
      var priority = row[cols.pri] || "Medium";
      var dueDate = row[cols.due] || "";
      
      var dueFmt = "";
      if (dueDate) {
        dueFmt = dueDate instanceof Date ? Utilities.formatDate(dueDate, Session.getScriptTimeZone(), "MMM dd, yyyy") : String(dueDate);
      }
      
      var pe = priority === "High" ? "🔴" : priority === "Low" ? "🟢" : "🟡";
      var msg = "⏰ *Task Reminder*\n\n*" + title + "*\n\n" + pe + " Priority: " + priority + "\n👤 Assigned to: " + assignee + "\n📋 Assigned by: " + assigner + (dueFmt ? "\n📅 Due: " + dueFmt : "");
      
      if (sendToCliq(webhookUrl, msg)) {
        sheet.getRange(r + 1, cols.sent + 1).setValue("Yes");
        sent++;
        Logger.log("✅ Reminder: " + title);
      }
    }
  }
  Logger.log(sent > 0 ? "📨 Sent " + sent + " reminder(s)" : "ℹ️ No reminders due");
}

// ═══════════════════════════════════════
// PART 2: NOTIFICATION QUEUE PROCESSOR
// ═══════════════════════════════════════
// The web app writes to a "Notifications" sheet when tasks are
// assigned or status changes. This picks them up and sends to Cliq.

function processNotifications() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Notifications");
  if (!sheet) return;
  
  var webhookUrl = getWebhookUrl(ss);
  if (!webhookUrl) return;
  
  var data = sheet.getDataRange().getValues();
  var sent = 0;
  
  for (var r = 1; r < data.length; r++) {
    var status = String(data[r][2] || "").trim();
    if (status !== "Pending") continue;
    
    var msg = String(data[r][1] || "").trim();
    if (!msg) continue;
    
    if (sendToCliq(webhookUrl, msg)) {
      sheet.getRange(r + 1, 3).setValue("Sent");
      sent++;
    } else {
      sheet.getRange(r + 1, 3).setValue("Failed");
    }
  }
  
  if (sent > 0) Logger.log("📨 Sent " + sent + " notification(s)");
  
  // Clean up old sent notifications (keep last 50)
  cleanupNotifications(sheet);
}

function cleanupNotifications(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length <= 51) return; // 1 header + 50 rows
  
  var toDelete = [];
  for (var r = 1; r < data.length - 50; r++) {
    var status = String(data[r][2] || "").trim();
    if (status === "Sent" || status === "Failed") toDelete.push(r + 1);
  }
  
  // Delete from bottom to top to preserve row indices
  for (var i = toDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(toDelete[i]);
  }
}

// ═══════════════════════════════════════
// SHARED UTILITIES
// ═══════════════════════════════════════

function sendToCliq(webhookUrl, messageText) {
  var payload = {
    text: messageText,
    card: { title: "⏰ Taskflow", theme: "modern-inline" }
  };
  
  try {
    var response = UrlFetchApp.fetch(webhookUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    return code >= 200 && code < 300;
  } catch (e) {
    Logger.log("❌ Cliq error: " + e.message);
    return false;
  }
}

function getWebhookUrl(ss) {
  var sheet = ss.getSheetByName("Settings");
  if (!sheet) return null;
  var data = sheet.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]).trim().toLowerCase().includes("webhook")) {
      var url = String(data[r][1]).trim();
      if (url && url.startsWith("http")) return url;
    }
  }
  return null;
}

function sendTestMessage() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var url = getWebhookUrl(ss);
  if (!url) { Logger.log("❌ No webhook URL!"); SpreadsheetApp.getUi().alert("No webhook URL in Settings sheet."); return; }
  
  var ok = sendToCliq(url, "🧪 *Test from Taskflow*\n\nIf you see this, your Zoho Cliq integration is working! 🎉");
  if (ok) {
    Logger.log("✅ Test sent!");
    SpreadsheetApp.getUi().alert("✅ Check your Cliq channel!");
  } else {
    Logger.log("❌ Test failed.");
    SpreadsheetApp.getUi().alert("❌ Failed. Check webhook URL.");
  }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu("⏰ Taskflow")
    .addItem("▶️ Check Now", "processAll")
    .addItem("🧪 Test Cliq", "sendTestMessage")
    .addSeparator()
    .addItem("⚙️ Setup", "setup")
    .addItem("🛑 Stop", "stopReminders")
    .addToUi();
}

function resetAllReminders() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Tasks");
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var col = -1;
  for (var h = 0; h < headers.length; h++) {
    if (String(headers[h]).trim().toLowerCase() === "reminder sent") { col = h; break; }
  }
  if (col === -1) return;
  for (var r = 1; r < data.length; r++) sheet.getRange(r + 1, col + 1).setValue("No");
  Logger.log("✅ Reset " + (data.length - 1) + " flags.");
}
