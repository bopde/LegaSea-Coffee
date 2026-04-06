# LegaSea Coffee Cart

A mobile-first operations app for the LegaSea coffee cart. Designed to run on a phone, tablet, or laptop at events — no installation required. Open the page, enter your Web App URL once, and you're ready to go.

The app covers the full event workflow: point of sale, sales reporting, stock tracking, reorder logging, and an event dashboard. All data is stored in a connected Google Sheet via Google Apps Script.

---

## What's in this repo

| File | Purpose |
|---|---|
| `coffee-cart-v6.html` | The app — a single HTML file, open it in any browser |
| `coffee-cart-appsscript-v6.js` | Google Apps Script backend — paste this into your Apps Script project |

---

## Setup

### 1. Create the Google Sheet

Create a new Google Sheet and add three tabs named exactly:

- `SalesReports`
- `StockLevels`
- `ReorderLog`

Headers are created automatically on first use.

### 2. Deploy the Apps Script

1. In your Google Sheet, go to **Extensions → Apps Script**
2. Delete the default `myFunction` stub
3. Paste the contents of `coffee-cart-appsscript-v6.js`
4. In Script Properties (**Project Settings → Script Properties**), add a property:
   - Key: `SHEET_ID`
   - Value: your Sheet ID (the long string in your Sheet's URL between `/d/` and `/edit`)
5. Click **Deploy → New Deployment**
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the Web App URL

### 3. Open the app

Open `coffee-cart-v6.html` in a browser. On first load you'll be prompted for the Web App URL — paste it in and save. That's it.

To share with the team, host the HTML file on GitHub Pages or any static file host and send the link. The Web App URL is stored locally in each device's browser — it never appears in the source code.

---

## Menu and pricing

| Item | Rg | Lg |
|---|---|---|
| White Coffee | $6 | $7 |
| Black Coffee | $5 | $5 |
| Hot Choc | $6 | $7 |
| Tea | $5 | $5 |
| Iced Coffee | $5 | — |
| Coke / Sprite / Coke Zero / L&P | $3 | — |
| Coffee - Other | Custom | — |
| Donation | Custom | — |

Oat milk is available on any milk-based drink for +$1.

---

## How the app works

### Sales Report (event workflow)

The main screen for an event. Fill in event details, then use the POS to record orders as you go. At the end of the event, review and submit the report to the Sheet.

**Three sections are independently editable:**
- **Sales** — auto-calculated from POS orders; can be manually overridden
- **Payment Totals** — auto-split from POS (cash vs eftpos); can be manually overridden
- **Stock Used** — auto-calculated from sales; can be manually overridden

Overriding one section never affects the others. Each has a Reset option to return to auto-calculated values.

Data is cached in the browser throughout the event. If you close the tab or go offline, nothing is lost — just reopen and continue.

### Stock

View current stock levels from the Sheet, update them manually, and log reorders (supplier, qty, cost per unit). Reorder costs feed into the dashboard P&L.

### Dashboard

Aggregated view of all submitted events, filterable by date range. Shows revenue, staff cost, stock cost, estimated profit, and top-selling products. Click any event for a full breakdown.

---

## Stock items

The app tracks these stock items by name. Names are used as keys between the frontend and the Sheet — they must match exactly if you edit either:

```
Cup - Lg
Cup - Rg
Milk - Cow 2L
Milk - Oat 1L
Beans - 1kg
Chocolate Powder - Bag
Chocolate Sauce - 500ml Bottle
Tea - Box
Iced Coffee - Can
Coke
Sprite
Coke Zero
L&P
```

---

## Stock auto-calculation rules

When stock is auto-calculated from sales, the app uses these rules:

- **Beans:** 19g per espresso-based drink (white coffee, black coffee, coffee-other)
- **Milk (cow):** 300ml per milk drink; oat milk is allocated proportionally based on the Alt Milk count
- **Milk (oat):** 300ml per alt milk drink, replacing cow milk
- **Choc sauce:** 50ml per hot choc
- **Cups:** Rg or Lg per drink type
- **Cans/bottles:** 1:1 per unit sold

---

## Dashboard P&L

The estimated profit calculation uses:

- **Revenue** — from submitted sales totals
- **Staff cost** — total hours worked × $30/hr
- **Stock cost** — qty used × most recent reorder cost per unit for each item

All three are estimates. Revenue is exact (from submitted totals), staff cost is exact (from logged hours), stock cost depends on reorder data being logged in the app.

---

## Offline behaviour

The app works fully offline. Data is saved to `localStorage` continuously — nothing is lost if you lose connection mid-event. Submission requires a connection; if offline, a banner is shown and you can resubmit once connectivity returns.

---

## Security

The Web App URL is the only credential protecting access to your Sheet. It is stored in each user's browser `localStorage` and is never embedded in the source code. Keep the URL private — do not share it publicly or commit it to this repo.

To revoke access, redeploy the Apps Script as a new deployment and distribute the new URL.

---

## Making changes

**To update the menu or prices:** edit the `MENU` array in `coffee-cart-v6.html`. Each item's `price`, `label`, and `size` fields control what appears in the POS.

**To update the staff list:** edit the `STAFF` array near the top of `coffee-cart-v6.html`.

**To add a stock item:** add it to `STOCK_ITEMS` in `coffee-cart-v6.html`. If it's a can or bottle sold through the POS, also add a `sk` property on the relevant menu item pointing to the new stock item name.

After any change, redeploy the Apps Script if the backend was affected, and re-host the HTML file.

---

## Built with

- React 18 (via CDN, no build step)
- Tailwind CSS (via CDN)
- Google Apps Script + Google Sheets
- Service worker for offline caching

*Part of the LegaSea / Kai Ika project ecosystem.*
