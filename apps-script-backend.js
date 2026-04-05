// =====================================================================
// COFFEE CART – Google Apps Script Backend v4
// =====================================================================
// SETUP:
// 1. Sheet tabs required: SalesReports | StockLevels | ReorderLog
// 2. Script Properties → SHEET_ID = your sheet's ID from the URL
// 3. Deploy as Web App: Execute as Me, access Anyone
// =====================================================================

function getSpreadsheet() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('SHEET_ID not set in Script Properties');
  return SpreadsheetApp.openById(id);
}

function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f5f5f5');
    }
  }
  return sheet;
}

// ── Sheet headers ──────────────────────────────────────────────────────
const SALES_HEADERS = [
  'Timestamp','Date','Event Name','Location','Completed By','Row Type',
  'Staff Name','Staff Start','Staff End','Hours',
  'Product','Qty Sold',
  'Cash Sales','Eftpos Sales','Total Sales',
  'Stock Item','Stock Qty Used',
  'Fridge Time','Fridge Temp (°C)',
  'Issues','Notes'
];
// Col index map (0-based, matches SALES_HEADERS above)
const C = {
  ts:0, date:1, eventName:2, location:3, completedBy:4, rowType:5,
  staffName:6, staffStart:7, staffEnd:8, hours:9,
  product:10, qty:11,
  cash:12, eftpos:13, total:14,
  stockItem:15, stockQty:16,
  fridgeTime:17, fridgeTemp:18,
  issues:19, notes:20
};

const STOCK_HEADERS   = ['Item','Current Level','Last Updated'];
const REORDER_HEADERS = ['Date','Supplier','Item','Qty','Cost Per Unit','Total Cost','Logged At'];

// ═══════════════════════════════════════════════════════════════════════
// doPost
// ═══════════════════════════════════════════════════════════════════════
function doPost(e) {
  try {
    const params = e.parameters || {};
    const action = (params.action || ['salesReport'])[0];
    if (action === 'reorder')     return handleReorder(params);
    if (action === 'updateStock') return handleUpdateStock(params);
    if (action === 'salesReport') return handleSalesReport(params);
    throw new Error('Unknown action: ' + action);
  } catch(err) {
    return jsonResp({ success: false, error: err.toString() });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// doGet
// ═══════════════════════════════════════════════════════════════════════
function doGet(e) {
  try {
    const action = (e.parameter || {}).action || '';
    if (action === 'getStock')  return handleGetStock();
    if (action === 'dashboard') return handleDashboard();
    return jsonResp({ success: false, error: 'Unknown GET action: ' + action });
  } catch(err) {
    return jsonResp({ success: false, error: err.toString() });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SALES REPORT
// ═══════════════════════════════════════════════════════════════════════
function handleSalesReport(params) {
  const ss    = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, 'SalesReports', SALES_HEADERS);
  const ts    = new Date().toISOString();

  const p = (key, idx) => ((params[key] || [])[idx || 0] || '');
  const date        = p('date');
  const eventName   = p('eventName');
  const location    = p('location');
  const completedBy = p('completedBy');
  const base        = [ts, date, eventName, location, completedBy];

  // Helper: pad a row out to full header length
  const row = (rowType, extra) => {
    const r = [...base, rowType, ...extra];
    while (r.length < SALES_HEADERS.length) r.push('');
    return r.slice(0, SALES_HEADERS.length);
  };

  // Staff rows
  (params['staffName[]'] || []).forEach((name, i) => {
    const start = (params['staffStart[]'] || [])[i] || '';
    const end   = (params['staffEnd[]']   || [])[i] || '';
    sheet.appendRow(row('STAFF', [name, start, end, calcHrs(start, end)]));
  });

  // Sales rows
  (params['saleProduct[]'] || []).forEach((product, i) => {
    const qty = (params['saleQty[]'] || [])[i] || '';
    sheet.appendRow(row('SALES', ['', '', '', '', product, qty]));
  });

  // Totals row
  const cash   = p('cashSales');
  const eftpos = p('eftposSales');
  const total  = p('totalSales');
  sheet.appendRow(row('SALES_TOTAL', ['', '', '', '', '', '', cash, eftpos, total]));

  // Stock used rows + deduct from stock sheet
  (params['stockItem[]'] || []).forEach((item, i) => {
    const qty = parseFloat((params['stockQty[]'] || [])[i]) || 0;
    sheet.appendRow(row('STOCK_USED', ['', '', '', '', '', '', '', '', '', item, qty]));
    if (qty > 0) deductStock(ss, item, qty);
  });

  // Fridge rows
  (params['fridgeTime[]'] || []).forEach((time, i) => {
    const temp = (params['fridgeTemp[]'] || [])[i] || '';
    sheet.appendRow(row('FRIDGE', ['', '', '', '', '', '', '', '', '', '', '', time, temp]));
  });

  // Notes row
  const issues = p('issues');
  const notes  = p('notes');
  if (issues || notes) {
    sheet.appendRow(row('NOTES', ['', '', '', '', '', '', '', '', '', '', '', '', '', issues, notes]));
  }

  return jsonResp({ success: true });
}

// ═══════════════════════════════════════════════════════════════════════
// GET STOCK
// ═══════════════════════════════════════════════════════════════════════
function handleGetStock() {
  const ss    = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, 'StockLevels', STOCK_HEADERS);
  const rows  = sheet.getDataRange().getValues();
  const stock = {};
  for (let i = 1; i < rows.length; i++) {
    const [item, level] = rows[i];
    if (item) stock[String(item)] = level !== '' ? parseFloat(level) : null;
  }
  return jsonResp({ success: true, stock, reorderLog: buildReorderLog(ss) });
}

function buildReorderLog(ss) {
  const sheet = getOrCreateSheet(ss, 'ReorderLog', REORDER_HEADERS);
  const rows  = sheet.getDataRange().getValues();
  const map   = {};
  for (let i = 1; i < rows.length; i++) {
    const [date, supplier, item, qty, cpu, totalCost] = rows[i];
    const key = `${date}||${supplier}`;
    if (!map[key]) map[key] = { date: String(date).slice(0, 10), supplier: String(supplier), items: [], totalCost: 0 };
    map[key].items.push({ item: String(item), qty: parseFloat(qty) || 0, costPerUnit: parseFloat(cpu) || 0 });
    map[key].totalCost += parseFloat(totalCost) || 0;
  }
  return Object.values(map).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
}

// ═══════════════════════════════════════════════════════════════════════
// REORDER
// ═══════════════════════════════════════════════════════════════════════
function handleReorder(params) {
  const ss           = getSpreadsheet();
  const reorderSheet = getOrCreateSheet(ss, 'ReorderLog', REORDER_HEADERS);
  const stockSheet   = getOrCreateSheet(ss, 'StockLevels', STOCK_HEADERS);
  const ts           = new Date().toISOString();
  // FIX Bug 1: params.date[0] is now always the actual date (not supplier)
  const date         = (params.date     || [todaySrv()])[0];
  const supplier     = (params.supplier || [''])[0];

  (params['item[]'] || []).forEach((item, i) => {
    const qty = parseFloat((params['qty[]']         || [])[i]) || 0;
    const cpu = parseFloat((params['costPerUnit[]'] || [])[i]) || 0;
    if (!item || qty <= 0) return;
    reorderSheet.appendRow([date, supplier, item, qty, cpu, Math.round(qty * cpu * 100) / 100, ts]);
    addToStock(stockSheet, item, qty);
  });

  return jsonResp({ success: true });
}

// ═══════════════════════════════════════════════════════════════════════
// UPDATE STOCK (manual level edit)
// ═══════════════════════════════════════════════════════════════════════
function handleUpdateStock(params) {
  const ss    = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, 'StockLevels', STOCK_HEADERS);
  (params['item[]'] || []).forEach((item, i) => {
    const qty = parseFloat((params['qty[]'] || [])[i]);
    if (item) setStockLevel(sheet, item, isNaN(qty) ? 0 : qty);
  });
  return jsonResp({ success: true });
}

// ── Stock sheet helpers ────────────────────────────────────────────────
function stockRow(sheet, item) {
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0]) === String(item)) return i + 1;
  return -1;
}
function setStockLevel(sheet, item, val) {
  const r   = stockRow(sheet, item);
  const now = new Date().toISOString();
  if (r > 0) { sheet.getRange(r, 2).setValue(val); sheet.getRange(r, 3).setValue(now); }
  else sheet.appendRow([item, val, now]);
}
function addToStock(sheet, item, qty) {
  const r   = stockRow(sheet, item);
  const now = new Date().toISOString();
  if (r > 0) {
    const cur = parseFloat(sheet.getRange(r, 2).getValue()) || 0;
    sheet.getRange(r, 2).setValue(Math.round((cur + qty) * 1000) / 1000);
    sheet.getRange(r, 3).setValue(now);
  } else {
    sheet.appendRow([item, qty, now]);
  }
}
function deductStock(ss, item, qty) {
  const sheet = getOrCreateSheet(ss, 'StockLevels', STOCK_HEADERS);
  const r     = stockRow(sheet, item);
  if (r > 0) {
    const cur = parseFloat(sheet.getRange(r, 2).getValue()) || 0;
    sheet.getRange(r, 2).setValue(Math.max(0, Math.round((cur - qty) * 1000) / 1000));
    sheet.getRange(r, 3).setValue(new Date().toISOString());
  }
}

// ═══════════════════════════════════════════════════════════════════════
// DASHBOARD
// Returns allEvents[] — each event has:
//   date, eventName, location, completedBy,
//   totalSales, cashSales, eftposSales,
//   staff[]      → [{name, start, end, hours}]
//   sales[]      → [{product, qty}]
//   stockUsed[]  → [{item, qty}]
//   equipmentIssues, notes,
//   staffCost (hours × $30),
//   stockCost (qty × most-recent cost per unit from ReorderLog)
// ═══════════════════════════════════════════════════════════════════════
function handleDashboard() {
  const ss         = getSpreadsheet();
  const salesSheet = getOrCreateSheet(ss, 'SalesReports', SALES_HEADERS);
  const rows       = salesSheet.getDataRange().getValues();

  // Most-recent cost per unit for each stock item (from ReorderLog)
  const reorderCosts = getMostRecentCosts(ss);

  // Group rows by event key = date || eventName
  const eventMap = {};

  for (let i = 1; i < rows.length; i++) {
    const r           = rows[i];
    const date        = String(r[C.date]).slice(0, 10);
    const eventName   = String(r[C.eventName]);
    const location    = String(r[C.location]);
    const completedBy = String(r[C.completedBy]);
    const rowType     = String(r[C.rowType]);

    const key = `${date}||${eventName}`;
    if (!eventMap[key]) {
      eventMap[key] = {
        date, eventName, location, completedBy,
        totalSales: 0, cashSales: '', eftposSales: '',
        staff: [], sales: [], stockUsed: [],
        equipmentIssues: '', notes: '',
        staffCost: 0, stockCost: 0,
      };
    }
    const ev = eventMap[key];

    if (rowType === 'STAFF' && r[C.staffName]) {
      const hrs = parseFloat(r[C.hours]) || 0;
      ev.staff.push({ name: String(r[C.staffName]), start: String(r[C.staffStart]), end: String(r[C.staffEnd]), hours: hrs });
      ev.staffCost += hrs * 30;
    }

    if (rowType === 'SALES' && r[C.product]) {
      ev.sales.push({ product: String(r[C.product]), qty: parseFloat(r[C.qty]) || 0 });
    }

    if (rowType === 'SALES_TOTAL') {
      ev.totalSales  = parseFloat(r[C.total]) || 0;
      ev.cashSales   = String(r[C.cash]);
      ev.eftposSales = String(r[C.eftpos]);
    }

    if (rowType === 'STOCK_USED' && r[C.stockItem]) {
      const qty  = parseFloat(r[C.stockQty]) || 0;
      const item = String(r[C.stockItem]);
      ev.stockUsed.push({ item, qty });
      ev.stockCost += qty * (reorderCosts[item] || 0);
    }

    if (rowType === 'NOTES') {
      ev.equipmentIssues = String(r[C.issues] || '');
      ev.notes           = String(r[C.notes]  || '');
    }
  }

  // Round costs, build array
  const allEvents = Object.values(eventMap).map(ev => ({
    ...ev,
    staffCost: Math.round(ev.staffCost * 100) / 100,
    stockCost: Math.round(ev.stockCost * 100) / 100,
  }));

  return jsonResp({ success: true, allEvents });
}

// Build map: stockItem → most recent cost per unit (last write wins)
function getMostRecentCosts(ss) {
  const sheet = getOrCreateSheet(ss, 'ReorderLog', REORDER_HEADERS);
  const rows  = sheet.getDataRange().getValues();
  const costs = {};
  for (let i = 1; i < rows.length; i++) {
    const item = String(rows[i][2]);
    const cpu  = parseFloat(rows[i][4]);
    if (item && !isNaN(cpu) && cpu > 0) costs[item] = cpu;  // later rows overwrite earlier → most recent wins
  }
  return costs;
}

// ═══════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════
function jsonResp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function calcHrs(start, end) {
  if (!start || !end) return '';
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let d = new Date(0, 0, 0, eh, em) - new Date(0, 0, 0, sh, sm);
  if (d < 0) d += 86400000;
  return Math.round((d / 3600000) * 100) / 100;
}

function todaySrv() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
