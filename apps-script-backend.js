// =====================================================================
// COFFEE CART – Google Apps Script Backend v2
// =====================================================================
// SETUP INSTRUCTIONS:
// 1. Create a new Google Sheet with these tabs:
//    - SalesReports
//    - StockLevels
//    - ReorderLog
// 2. Open Extensions > Apps Script and paste this code.
// 3. Go to Project Settings > Script Properties and add:
//    SHEET_ID → the ID from your Google Sheet URL
// 4. Deploy > New deployment > Web App
//    - Execute as: Me
//    - Who has access: Anyone
// 5. Copy the Web App URL into the Coffee Cart app setup screen.
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
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#f0f0f0');
    }
  }
  return sheet;
}

// =====================================================================
// SHEET HEADERS
// =====================================================================
const SALES_HEADERS = [
  'Submission Timestamp', 'Date', 'Event Name', 'Location', 'Completed By',
  'Row Type',
  'Staff Name', 'Staff Start', 'Staff End', 'Hours Worked',
  'Product', 'Quantity Sold',
  'Cash Sales', 'Eftpos Sales', 'Total Sales',
  'Stock Item', 'Stock Qty Used',
  'Fridge Time', 'Fridge Temp (°C)',
  'Crowd Notes', 'Equipment Issues', 'LegaSea Signups', 'Notes'
];

const STOCK_HEADERS   = ['Item', 'Current Level', 'Last Updated'];
// Added Cost Per Unit and Total Cost columns
const REORDER_HEADERS = ['Date', 'Supplier', 'Item', 'Quantity', 'Cost Per Unit', 'Total Cost', 'Logged At'];

// =====================================================================
// doPost — all write actions
// =====================================================================
function doPost(e) {
  try {
    const params = e.parameters || {};
    const action = (params.action || ['salesReport'])[0];

    if (action === 'reorder')     return handleReorder(params);
    if (action === 'updateStock') return handleUpdateStock(params);
    if (action === 'salesReport') return handleSalesReport(params);

    throw new Error('Unknown POST action: ' + action);
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// =====================================================================
// doGet — all read actions
// =====================================================================
function doGet(e) {
  try {
    const params = e.parameter || {};
    const action = params.action || '';

    if (action === 'getStock')  return handleGetStock();
    if (action === 'dashboard') return handleDashboard();

    return jsonResponse({ success: false, error: 'Unknown GET action: ' + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// =====================================================================
// SALES REPORT
// =====================================================================
function handleSalesReport(params) {
  const ss        = getSpreadsheet();
  const sheet     = getOrCreateSheet(ss, 'SalesReports', SALES_HEADERS);
  const timestamp = new Date().toISOString();

  const date        = (params.date        || [''])[0];
  const eventName   = (params.eventName   || [''])[0];
  const location    = (params.location    || [''])[0];
  const completedBy = (params.completedBy || [''])[0];
  const cashSales   = parseFloat((params.cashSales   || ['0'])[0]) || 0;
  const eftposSales = parseFloat((params.eftposSales || ['0'])[0]) || 0;
  const totalSales  = parseFloat((params.totalSales  || ['0'])[0]) || 0;
  const crowdNotes  = (params.crowdNotes       || [''])[0];
  const equipIssues = (params.equipmentIssues  || [''])[0];
  const signups     = (params.legaseaSignups   || [''])[0];
  const notes       = (params.notes            || [''])[0];

  // Helper: pad a row to full width
  const base = [timestamp, date, eventName, location, completedBy];
  const pad  = (arr) => {
    const row = [...base, ...arr];
    while (row.length < SALES_HEADERS.length) row.push('');
    return row;
  };

  // STAFF rows
  const staffNames = params['staffName[]'] || [];
  staffNames.forEach((name, i) => {
    const start = (params['staffStart[]'] || [])[i] || '';
    const end   = (params['staffEnd[]']   || [])[i] || '';
    sheet.appendRow(pad([
      'STAFF',
      name, start, end, calculateHours(start, end)
    ]));
  });

  // SALES rows
  const products = params['saleProduct[]'] || [];
  products.forEach((product, i) => {
    const qty = (params['saleQty[]'] || [])[i] || '';
    sheet.appendRow(pad([
      'SALES',
      '','','','',       // staff cols
      product, qty
    ]));
  });

  // TOTALS row
  sheet.appendRow(pad([
    'SALES_TOTAL',
    '','','','',
    '','',
    cashSales, eftposSales, totalSales
  ]));

  // STOCK USED rows + deduct from stock sheet
  const stockItems = params['stockItem[]'] || [];
  stockItems.forEach((item, i) => {
    const qty = parseFloat((params['stockQty[]'] || [])[i]) || 0;
    sheet.appendRow(pad([
      'STOCK_USED',
      '','','','',
      '','',
      '','','',
      item, qty
    ]));
    if (qty > 0) deductStock(ss, item, qty);
  });

  // FRIDGE rows
  const fridgeTimes = params['fridgeTime[]'] || [];
  fridgeTimes.forEach((time, i) => {
    const temp = (params['fridgeTemp[]'] || [])[i] || '';
    sheet.appendRow(pad([
      'FRIDGE',
      '','','','',
      '','',
      '','','',
      '','',
      time, temp
    ]));
  });

  // NOTES row
  if (crowdNotes || equipIssues || signups || notes) {
    sheet.appendRow(pad([
      'NOTES',
      '','','','',
      '','',
      '','','',
      '','',
      '','',
      crowdNotes, equipIssues, signups, notes
    ]));
  }

  return jsonResponse({ success: true });
}

// =====================================================================
// STOCK — GET
// =====================================================================
function handleGetStock() {
  const ss    = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, 'StockLevels', STOCK_HEADERS);
  const data  = sheet.getDataRange().getValues();

  const stock = {};
  for (let i = 1; i < data.length; i++) {
    const [item, level] = data[i];
    if (item) stock[String(item)] = level !== '' ? parseFloat(level) : null;
  }

  const reorderLog = buildReorderLog(ss);
  return jsonResponse({ success: true, stock, reorderLog });
}

function buildReorderLog(ss) {
  const sheet = getOrCreateSheet(ss, 'ReorderLog', REORDER_HEADERS);
  const data  = sheet.getDataRange().getValues();
  const map   = {};

  for (let i = 1; i < data.length; i++) {
    const [date, supplier, item, qty, costPerUnit, totalCost] = data[i];
    const key = `${date}__${supplier}`;
    if (!map[key]) {
      map[key] = {
        date:      String(date).slice(0, 10),
        supplier:  String(supplier),
        items:     [],
        totalCost: 0
      };
    }
    map[key].items.push({
      item:        String(item),
      qty:         parseFloat(qty)         || 0,
      costPerUnit: parseFloat(costPerUnit) || 0,
      totalCost:   parseFloat(totalCost)   || 0
    });
    map[key].totalCost += parseFloat(totalCost) || 0;
  }

  return Object.values(map)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);
}

// =====================================================================
// STOCK — REORDER
// =====================================================================
function handleReorder(params) {
  const ss          = getSpreadsheet();
  const reorderSheet = getOrCreateSheet(ss, 'ReorderLog',  REORDER_HEADERS);
  const stockSheet   = getOrCreateSheet(ss, 'StockLevels', STOCK_HEADERS);
  const timestamp    = new Date().toISOString();

  const date     = (params.date     || [todayServer()])[0];
  const supplier = (params.supplier || [''])[0];
  const items    = params['item[]'] || [];
  const qtys     = params['qty[]']  || [];
  const costs    = params['costPerUnit[]'] || [];

  items.forEach((item, i) => {
    const qty         = parseFloat(qtys[i])  || 0;
    const costPerUnit = parseFloat(costs[i]) || 0;
    const totalCost   = Math.round(qty * costPerUnit * 100) / 100;

    if (!item || qty <= 0) return;

    reorderSheet.appendRow([date, supplier, item, qty, costPerUnit, totalCost, timestamp]);
    addStock(stockSheet, item, qty);
  });

  return jsonResponse({ success: true });
}

// =====================================================================
// STOCK — MANUAL UPDATE
// =====================================================================
function handleUpdateStock(params) {
  const ss    = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, 'StockLevels', STOCK_HEADERS);
  const items = params['item[]'] || [];
  const qtys  = params['qty[]']  || [];

  items.forEach((item, i) => {
    const qty = parseFloat(qtys[i]);
    if (!item) return;
    setStockLevel(sheet, item, isNaN(qty) ? 0 : qty);
  });

  return jsonResponse({ success: true });
}

// =====================================================================
// STOCK HELPERS
// =====================================================================
function getStockRowIndex(sheet, item) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(item)) return i + 1; // 1-indexed
  }
  return -1;
}

function setStockLevel(sheet, item, newLevel) {
  const row = getStockRowIndex(sheet, item);
  const now = new Date().toISOString();
  if (row > 0) {
    sheet.getRange(row, 2).setValue(newLevel);
    sheet.getRange(row, 3).setValue(now);
  } else {
    sheet.appendRow([item, newLevel, now]);
  }
}

function addStock(sheet, item, qtyToAdd) {
  const row = getStockRowIndex(sheet, item);
  const now = new Date().toISOString();
  if (row > 0) {
    const current = parseFloat(sheet.getRange(row, 2).getValue()) || 0;
    sheet.getRange(row, 2).setValue(Math.round((current + qtyToAdd) * 1000) / 1000);
    sheet.getRange(row, 3).setValue(now);
  } else {
    sheet.appendRow([item, qtyToAdd, now]);
  }
}

function deductStock(ss, item, qtyToDeduct) {
  const sheet = getOrCreateSheet(ss, 'StockLevels', STOCK_HEADERS);
  const row   = getStockRowIndex(sheet, item);
  if (row > 0) {
    const current  = parseFloat(sheet.getRange(row, 2).getValue()) || 0;
    const newLevel = Math.max(0, Math.round((current - qtyToDeduct) * 1000) / 1000);
    sheet.getRange(row, 2).setValue(newLevel);
    sheet.getRange(row, 3).setValue(new Date().toISOString());
  }
}

// =====================================================================
// DASHBOARD
// =====================================================================
function handleDashboard() {
  const ss    = getSpreadsheet();
  const sheet = getOrCreateSheet(ss, 'SalesReports', SALES_HEADERS);
  const data  = sheet.getDataRange().getValues();

  let totalRevenue = 0;
  let totalSignups = 0;
  const events         = {};
  const productTotals  = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // Columns: timestamp(0), date(1), eventName(2), location(3), completedBy(4),
    //          rowType(5), staffName(6..9), product(10), qty(11),
    //          cash(12), eftpos(13), total(14), stockItem(15), stockQty(16),
    //          fridgeTime(17), fridgeTemp(18), crowdNotes(19), equipIssues(20),
    //          signups(21), notes(22)
    const date      = row[1];
    const eventName = row[2];
    const location  = row[3];
    const rowType   = row[5];
    const product   = row[10];
    const qtySold   = row[11];
    const totalSales = row[14];
    const signups    = row[21];

    const eventKey = `${date}__${eventName}`;

    if (rowType === 'SALES_TOTAL') {
      const t = parseFloat(totalSales) || 0;
      totalRevenue += t;
      if (!events[eventKey]) events[eventKey] = { date: String(date).slice(0,10), eventName: String(eventName), location: String(location), totalSales: 0, signups: 0 };
      events[eventKey].totalSales = t.toFixed(2);
    }

    if (rowType === 'SALES' && product) {
      const q = parseFloat(qtySold) || 0;
      productTotals[String(product)] = (productTotals[String(product)] || 0) + q;
    }

    if (rowType === 'NOTES' && signups) {
      const s = parseInt(signups) || 0;
      totalSignups += s;
      if (!events[eventKey]) events[eventKey] = { date: String(date).slice(0,10), eventName: String(eventName), location: String(location), totalSales: 0, signups: 0 };
      events[eventKey].signups = (events[eventKey].signups || 0) + s;
    }
  }

  const recentEvents = Object.values(events)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  const topProducts = Object.entries(productTotals)
    .map(([product, qty]) => ({ product, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 8);

  const totalEvents = Object.keys(events).length;
  const avgRevenue  = totalEvents > 0
    ? (totalRevenue / totalEvents).toFixed(2)
    : '0.00';

  // Stock levels
  const stockSheet  = getOrCreateSheet(ss, 'StockLevels', STOCK_HEADERS);
  const stockData   = stockSheet.getDataRange().getValues();
  const stockLevels = {};
  for (let i = 1; i < stockData.length; i++) {
    const [item, level] = stockData[i];
    if (item) stockLevels[String(item)] = level !== '' ? parseFloat(level) : null;
  }

  return jsonResponse({
    success: true,
    totalEvents,
    totalRevenue: totalRevenue.toFixed(2),
    avgRevenue,
    totalSignups,
    recentEvents,
    topProducts,
    stockLevels
  });
}

// =====================================================================
// UTILITIES
// =====================================================================
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function calculateHours(start, end) {
  if (!start || !end) return '';
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = new Date(0, 0, 0, eh, em) - new Date(0, 0, 0, sh, sm);
  if (diff < 0) diff += 24 * 60 * 60 * 1000;
  return Math.round((diff / 36e5) * 100) / 100;
}

function todayServer() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
