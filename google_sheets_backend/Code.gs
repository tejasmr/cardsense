/**
 * CardSense India - Google Sheets Backend (Google Apps Script)
 * 
 * Instructions:
 * 1. Create a new Google Sheet named "CardSense_DB" (or any name).
 * 2. In Google Sheets, click "Extensions" -> "Apps Script".
 * 3. Delete any default code and paste this ENTIRE file into Code.gs.
 * 4. Run the function "setupSpreadsheet" once from the toolbar to automatically create the required tabs & headers.
 * 5. Add your Gmail address to the "allowed_users" tab.
 * 6. Click "Deploy" (top right) -> "New deployment":
 *    - Select type: "Web app"
 *    - Description: "CardSense API"
 *    - Execute as: "Me"
 *    - Who has access: "Anyone" (crucial so your GitHub Pages site can make requests)
 * 7. Click "Deploy", authorize permissions, and copy the Web App URL (ends in /exec).
 * 8. Paste that URL into your CardSense dashboard on GitHub Pages!
 */

const SHEET_ALLOWED_USERS = "allowed_users";
const SHEET_USER_CONFIGS = "user_configs";
const SHEET_CUSTOM_CARDS = "custom_cards";

/**
 * Run this function once inside the Apps Script editor to create the sheets and initial headers.
 */
function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Allowed Users Tab
  let allowedSheet = ss.getSheetByName(SHEET_ALLOWED_USERS);
  if (!allowedSheet) {
    allowedSheet = ss.insertSheet(SHEET_ALLOWED_USERS);
    allowedSheet.appendRow(["email", "name", "role", "added_at"]);
    allowedSheet.getRange(1, 1, 1, 4).setFontWeight("bold").setBackground("#eef2ff");
    // Add default user placeholder
    const ownerEmail = Session.getActiveUser().getEmail() || "your.email@gmail.com";
    allowedSheet.appendRow([ownerEmail.toLowerCase().trim(), "Admin", "owner", new Date()]);
  }

  // 2. User Configs Tab
  let configsSheet = ss.getSheetByName(SHEET_USER_CONFIGS);
  if (!configsSheet) {
    configsSheet = ss.insertSheet(SHEET_USER_CONFIGS);
    configsSheet.appendRow(["email", "selected_cards_json", "monthly_spend_json", "weights_json", "updated_at"]);
    configsSheet.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#f0fdf4");
  }

  // 3. Custom Cards Tab
  let cardsSheet = ss.getSheetByName(SHEET_CUSTOM_CARDS);
  if (!cardsSheet) {
    cardsSheet = ss.insertSheet(SHEET_CUSTOM_CARDS);
    cardsSheet.appendRow(["card_id", "card_name", "bank", "data_json", "created_by_email", "created_at"]);
    cardsSheet.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#fef2f2");
  }

  // Delete default "Sheet1" if empty
  const defaultSheet = ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1) {
    try { ss.deleteSheet(defaultSheet); } catch (e) {}
  }

  Logger.log("CardSense_DB setup successfully completed!");
}

/**
 * Verifies if an email is present in the "allowed_users" tab.
 */
function isEmailAllowed(email) {
  if (!email) return false;
  const cleanEmail = String(email).toLowerCase().trim();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_ALLOWED_USERS);
  if (!sheet) return false;

  const data = sheet.getDataRange().getValues();
  // Row 0 is headers, scan column 0 (email)
  for (let i = 1; i < data.length; i++) {
    const rowEmail = String(data[i][0]).toLowerCase().trim();
    if (rowEmail === cleanEmail) {
      return true;
    }
  }
  return false;
}

/**
 * Handles HTTP GET requests from GitHub Pages.
 */
function doGet(e) {
  const params = e.parameter || {};
  const action = params.action || "ping";
  const email = (params.email || "").toLowerCase().trim();

  // CORS headers wrapper
  const output = (data, statusCode) => {
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  };

  if (action === "ping") {
    return output({ status: "success", message: "CardSense Google Sheets API is running" });
  }

  // Enforce Allowlist for all user data queries
  if (!email || !isEmailAllowed(email)) {
    return output({
      status: "unauthorized",
      code: "NOT_ON_ALLOWLIST",
      message: "Access restricted. The email '" + email + "' is not on the authorized user list."
    });
  }

  // Get user config
  if (action === "getConfig") {
    const config = getUserConfigFromSheet(email);
    return output({
      status: "success",
      email: email,
      config: config
    });
  }

  // Check allowlist status
  if (action === "checkAccess") {
    return output({
      status: "success",
      allowed: true,
      email: email
    });
  }

  return output({ status: "error", message: "Unknown action" });
}

/**
 * Handles HTTP POST requests from GitHub Pages.
 */
function doPost(e) {
  const output = (data) => {
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  };

  let payload = {};
  try {
    if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }
  } catch (err) {
    return output({ status: "error", message: "Invalid JSON body: " + err.message });
  }

  const action = payload.action || "saveConfig";
  const email = (payload.email || "").toLowerCase().trim();

  // Enforce Allowlist
  if (!email || !isEmailAllowed(email)) {
    return output({
      status: "unauthorized",
      code: "NOT_ON_ALLOWLIST",
      message: "Access restricted. The email '" + email + "' is not on the authorized user list."
    });
  }

  // Save/Update user configuration
  if (action === "saveConfig") {
    const config = payload.config || {};
    saveUserConfigToSheet(email, config);
    return output({
      status: "success",
      message: "Configuration saved to Google Sheet successfully",
      email: email
    });
  }

  // Save custom card
  if (action === "saveCustomCard") {
    const card = payload.card || {};
    saveCustomCardToSheet(email, card);
    return output({
      status: "success",
      message: "Custom card saved to Google Sheet",
      cardId: card.id
    });
  }

  return output({ status: "error", message: "Unknown action" });
}

/**
 * Reads user config from the "user_configs" sheet.
 */
function getUserConfigFromSheet(email) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_USER_CONFIGS);
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const rowEmail = String(data[i][0]).toLowerCase().trim();
    if (rowEmail === email) {
      return {
        selected_card_ids: JSON.parse(data[i][1] || "[]"),
        spend_profile: { monthly_spend: JSON.parse(data[i][2] || "{}") },
        weights: JSON.parse(data[i][3] || "{}"),
        updated_at: data[i][4]
      };
    }
  }
  return null;
}

/**
 * Saves or updates user config in the "user_configs" sheet.
 */
function saveUserConfigToSheet(email, config) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_USER_CONFIGS);
  if (!sheet) return;

  const selectedCardsJson = JSON.stringify(config.selected_card_ids || []);
  const monthlySpendJson = JSON.stringify(config.spend_profile ? config.spend_profile.monthly_spend : {});
  const weightsJson = JSON.stringify(config.weights || {});
  const now = new Date();

  const data = sheet.getDataRange().getValues();
  let foundRow = -1;

  for (let i = 1; i < data.length; i++) {
    const rowEmail = String(data[i][0]).toLowerCase().trim();
    if (rowEmail === email) {
      foundRow = i + 1; // 1-indexed row
      break;
    }
  }

  if (foundRow > 0) {
    sheet.getRange(foundRow, 2).setValue(selectedCardsJson);
    sheet.getRange(foundRow, 3).setValue(monthlySpendJson);
    sheet.getRange(foundRow, 4).setValue(weightsJson);
    sheet.getRange(foundRow, 5).setValue(now);
  } else {
    sheet.appendRow([email, selectedCardsJson, monthlySpendJson, weightsJson, now]);
  }
}

/**
 * Saves a custom card into "custom_cards" sheet.
 */
function saveCustomCardToSheet(email, card) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_CUSTOM_CARDS);
  if (!sheet) return;

  sheet.appendRow([
    card.id,
    card.name,
    card.bank,
    JSON.stringify(card),
    email,
    new Date()
  ]);
}
