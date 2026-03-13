// ╔══════════════════════════════════════════════════════════════╗
// ║  TASKFLOW — Google Apps Script for Zoho Cliq Reminders     ║
// ║  Reads tasks from Google Sheet, sends reminders to Cliq    ║
// ╚══════════════════════════════════════════════════════════════╝
//
// SETUP INSTRUCTIONS:
// 1. Open your Taskflow Google Sheet
// 2. Go to Extensions → Apps Script
// 3. Delete any code in the editor
// 4. Paste this ENTIRE file
// 5. Click Save (💾 icon)
// 6. Run the "setup" function once (select it from dropdown → click ▶️ Run)
// 7. Approve permissions when prompted
// 8. Done! Reminders will check every 5 minutes automatically.

// ─── CONFIGURATION ───
// The webhook URL is read from the "Settings" sheet in your spreadsheet.
// You can also hardcode it here if you prefer:
var HARDCODED_WEBHOOK_URL = ""; // Leave empty to use Settings sheet

/**
 * ONE-TIME SETUP: Run this function once to create the automatic timer.
 * Select "setup" from the function dropdown above and click ▶️ Run.
 */
function setup() {
  // Remove any existing triggers to avoid duplicates
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "checkReminders") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  // Create a new trigger that runs every 5 minutes
  ScriptApp.newTrigger("checkReminders")
    .timeBased()
    .everyMinutes(5)
    .create();
  
  Logger.log("✅ Setup complete! Reminders will be checked every 5 minutes.");
  Logger.log("💡 You can also run 'checkReminders' manually to test.");
  
  // Run once immediately to test
  checkReminders();
}

/**
 * Remove all automatic triggers (stops the reminder system).
 */
function stopReminders() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "checkReminders") {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  Logger.log("🛑 Stopped. Removed " + removed + " trigger(s).");
}

/**
 * MAIN FUNCTION: Checks all tasks for due reminders and sends to Zoho Cliq.
 * This runs automatically every 5 minutes after setup.
 */
function checkReminders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var taskSheet = ss.getSheetByName("Tasks");
  
  if (!taskSheet) {
    Logger.log("❌ No 'Tasks' sheet found!");
    return;
  }
  
  var webhookUrl = getWebhookUrl(ss);
  if (!webhookUrl) {
    Logger.log("⚠️ No webhook URL configured. Set it in the Settings sheet or in the script.");
    return;
  }
  
  var data = taskSheet.getDataRange().getValues();
  var headers = data[0];
  var now = new Date();
  var sentCount = 0;
  
  // Find column indices
  var cols = {};
  for (var h = 0; h < headers.length; h++) {
    var header = String(headers[h]).trim().toLowerCase();
    if (header === "task id") cols.id = h;
    else if (header === "title") cols.title = h;
    else if (header === "description") cols.desc = h;
    else if (header === "assigned to") cols.assignee = h;
    else if (header === "assigned by") cols.assigner = h;
    else if (header === "priority") cols.priority = h;
    else if (header === "status") cols.status = h;
    else if (header === "due date") cols.due = h;
    else if (header === "reminder time") cols.reminder = h;
    else if (header === "reminder sent") cols.sent = h;
  }
  
  // Check each task
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    
    // Skip if no reminder time set
    var reminderVal = row[cols.reminder];
    if (!reminderVal) continue;
    
    // Skip if already sent
    var sentVal = String(row[cols.sent] || "").trim().toLowerCase();
    if (sentVal === "yes") continue;
    
    // Skip if task is done
    var status = String(row[cols.status] || "").trim().toLowerCase();
    if (status === "done") continue;
    
    // Parse reminder time
    var reminderTime;
    if (reminderVal instanceof Date) {
      reminderTime = reminderVal;
    } else {
      reminderTime = new Date(String(reminderVal));
    }
    
    if (isNaN(reminderTime.getTime())) {
      Logger.log("⚠️ Row " + (r + 1) + ": Invalid reminder time '" + reminderVal + "'");
      continue;
    }
    
    // Check if reminder time has passed
    if (reminderTime <= now) {
      var task = {
        id: row[cols.id] || "",
        title: row[cols.title] || "Untitled Task",
        description: row[cols.desc] || "",
        assignee: row[cols.assignee] || "Unassigned",
        assigner: row[cols.assigner] || "Unknown",
        priority: row[cols.priority] || "Medium",
        status: row[cols.status] || "To Do",
        dueDate: row[cols.due] || ""
      };
      
      // Format due date
      var dueDateStr = "";
      if (task.dueDate) {
        if (task.dueDate instanceof Date) {
          dueDateStr = Utilities.formatDate(task.dueDate, Session.getScriptTimeZone(), "MMM dd, yyyy");
        } else {
          dueDateStr = String(task.dueDate);
        }
      }
      
      // Send to Zoho Cliq
      var success = sendToCliq(webhookUrl, task, dueDateStr);
      
      if (success) {
        // Mark as sent in the sheet
        taskSheet.getRange(r + 1, cols.sent + 1).setValue("Yes");
        sentCount++;
        Logger.log("✅ Reminder sent: " + task.title + " → " + task.assignee);
      } else {
        Logger.log("❌ Failed to send: " + task.title);
      }
    }
  }
  
  if (sentCount === 0) {
    Logger.log("ℹ️ No reminders due at " + now.toLocaleString());
  } else {
    Logger.log("📨 Sent " + sentCount + " reminder(s) at " + now.toLocaleString());
  }
}

/**
 * Sends a formatted task reminder message to Zoho Cliq.
 */
function sendToCliq(webhookUrl, task, dueDateStr) {
  var priorityEmoji = "🟡";
  var p = String(task.priority).trim().toLowerCase();
  if (p === "high") priorityEmoji = "🔴";
  else if (p === "low") priorityEmoji = "🟢";
  
  var messageText = "⏰ *Task Reminder*\n\n"
    + "*" + task.title + "*"
    + (task.description ? "\n" + task.description : "")
    + "\n\n"
    + priorityEmoji + " Priority: " + task.priority + "\n"
    + "👤 Assigned to: " + task.assignee + "\n"
    + "📋 Assigned by: " + task.assigner
    + (dueDateStr ? "\n📅 Due: " + dueDateStr : "")
    + "\n📊 Status: " + task.status;
  
  var payload = {
    text: messageText,
    card: {
      title: "⏰ Taskflow Reminder",
      theme: "modern-inline"
    }
  };
  
  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  try {
    var response = UrlFetchApp.fetch(webhookUrl, options);
    var code = response.getResponseCode();
    if (code >= 200 && code < 300) {
      return true;
    } else {
      Logger.log("❌ Cliq API returned " + code + ": " + response.getContentText().substring(0, 200));
      return false;
    }
  } catch (e) {
    Logger.log("❌ Error sending to Cliq: " + e.message);
    return false;
  }
}

/**
 * Gets the webhook URL from Settings sheet or hardcoded value.
 */
function getWebhookUrl(ss) {
  if (HARDCODED_WEBHOOK_URL) return HARDCODED_WEBHOOK_URL;
  
  var settingsSheet = ss.getSheetByName("Settings");
  if (!settingsSheet) return null;
  
  var data = settingsSheet.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]).trim().toLowerCase() === "zoho cliq webhook url") {
      var url = String(data[r][1]).trim();
      if (url && url.startsWith("http")) return url;
    }
  }
  return null;
}

/**
 * MANUAL TEST: Send a test message to Zoho Cliq to verify the connection.
 * Select "sendTestMessage" from the dropdown and click ▶️ Run.
 */
function sendTestMessage() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var webhookUrl = getWebhookUrl(ss);
  
  if (!webhookUrl) {
    Logger.log("❌ No webhook URL found! Add it to the Settings sheet first.");
    return;
  }
  
  var testTask = {
    title: "Test Reminder from Taskflow",
    description: "If you see this in Zoho Cliq, your integration is working! 🎉",
    assignee: "Everyone",
    assigner: "Taskflow Bot",
    priority: "Medium",
    status: "Test"
  };
  
  var success = sendToCliq(webhookUrl, testTask, "N/A");
  
  if (success) {
    Logger.log("✅ Test message sent! Check your Zoho Cliq channel.");
    SpreadsheetApp.getUi().alert("✅ Success! Check your Zoho Cliq channel for the test message.");
  } else {
    Logger.log("❌ Test message failed. Check the webhook URL in Settings sheet.");
    SpreadsheetApp.getUi().alert("❌ Failed! Check your webhook URL in the Settings sheet and try again.");
  }
}

/**
 * Adds a custom menu to the Google Sheet for easy access.
 * This runs automatically when you open the spreadsheet.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("⏰ Taskflow")
    .addItem("▶️ Check Reminders Now", "checkReminders")
    .addItem("🧪 Send Test Message", "sendTestMessage")
    .addSeparator()
    .addItem("⚙️ Setup Auto-Reminders", "setup")
    .addItem("🛑 Stop Auto-Reminders", "stopReminders")
    .addToUi();
}

/**
 * UTILITY: Generates a new Task ID based on the highest existing ID.
 * Can be called from the sheet using =generateTaskId()
 */
function generateTaskId() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Tasks");
  var data = sheet.getDataRange().getValues();
  var maxNum = 0;
  
  for (var r = 1; r < data.length; r++) {
    var id = String(data[r][0]);
    var match = id.match(/TASK(\d+)/);
    if (match) {
      var num = parseInt(match[1]);
      if (num > maxNum) maxNum = num;
    }
  }
  
  return "TASK" + String(maxNum + 1).padStart(3, "0");
}

/**
 * UTILITY: Resets all "Reminder Sent" flags to "No".
 * Useful when you want to re-send all reminders.
 */
function resetAllReminders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Tasks");
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  
  var sentCol = -1;
  for (var h = 0; h < headers.length; h++) {
    if (String(headers[h]).trim().toLowerCase() === "reminder sent") {
      sentCol = h;
      break;
    }
  }
  
  if (sentCol === -1) {
    Logger.log("❌ 'Reminder Sent' column not found!");
    return;
  }
  
  for (var r = 1; r < data.length; r++) {
    sheet.getRange(r + 1, sentCol + 1).setValue("No");
  }
  
  Logger.log("✅ Reset " + (data.length - 1) + " reminder flags.");
}
