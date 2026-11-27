# Changelog

## 0.4.0 — 2026-11-27
- **In-app Help**: 11 illustrated guides (getting started, stock purchases, personal items, sales, refunds, expenses, eBay import, tax years & SA103, platform check, Excel download, settings) with search
- Help in the ☰ menu on phones and a **? Help** button beside Settings on desktop
- "How does this work?" link on each main page opens the matching guide
- Guides are Markdown files in `help/` — edit the wording on GitHub; screenshots live in `public/guide-img/`
- Fix: the platform check table on the dashboard was cut off on phones; it now scrolls sideways

## 0.3.3 — 2026-11-27
- After an eBay import the app goes to the Dashboard, opened on the tax year of the imported sales, with the "eBay import complete" banner
- Buttons on every save form are disabled as soon as they're pressed ("Importing… please wait" on the import), so a double-tap can't submit twice
- Imports now run one at a time on the server, so two submissions can't both get past the "already imported" check
- Fix: an order the app couldn't import (no price/date) used to leave a new item behind with no sale — the sale is now checked first
- eBay "--" placeholder cells are treated as empty (no more items named "--")

## 0.3.2 — 2026-11-27
- eBay import: "Create new business item" / "Create new personal item" on each order, for past sales not yet in the app — the item is named from the eBay title and the sale imported in one step
- Business items can be given what was paid and when: recorded as a one-item stock purchase so the cost counts in that tax year
- "Create business items" / "Create personal items" buttons fill every unmatched order at once
- Clearer message when nothing is selected
- **Fix:** on phones the import preview hid the item drop-down column, so nothing could be matched; orders now show as cards with the drop-down visible

## 0.3.1 — 2026-11-27
- Desktop: Settings is now a clear button with a gear icon (highlighted when you're on the Settings page)
- Phone layout (title row + page row + ☰ menu) now also used for windows up to 760px wide, e.g. iPad portrait or a narrow laptop window, where the page links used to wrap
- "Signed in as…" hidden on mid-size screens to save room

## 0.3.0 — 2026-11-27
**Needs Caspio:** new table `CSP_Settings` (see SETUP.md).
- Settings page: app name, colour scheme (buttons, button text, page background, panels, header, text) with six presets, live preview and readability warnings, app icon/favicon upload (also used for the iPhone home-screen icon), reset to defaults
- Phones: hamburger menu at top right holding "Signed in as…", Settings and Log out; desktop shows them inline on the right
- Muted text, borders and the phone page-row background are worked out from the chosen colours, so every scheme stays consistent

## 0.2.2 — 2026-11-27
- Phone layout: title and log out on one row, the five pages in an equal-width row underneath (current page highlighted)
- Phone dashboard: full-width "Record a sale" button, other actions share a row, figure tiles in a 2×2 grid
- Respects the iPhone notch / Dynamic Island safe area; desktop layout unchanged

## 0.2.1 — 2026-11-26
- Login usernames ignore capitals and leading/trailing spaces (phones capitalising "Kate" no longer fail)
- Username box turns off autocorrect/spellcheck
- Logs which usernames are configured at startup, and failed login attempts (never passwords)

## 0.2.0 — 2026-11-26
**Needs Caspio changes before merging** — see SETUP.md: new table `CSP_Expenses`, and new fields `RefundDate`, `RefundAmount`, `ItemReturned` on `CSP_Sales`.
- Expenses: everyday expense types mapped to SA103 categories, mileage at 45p/mile, receipt photo/PDF stored in a Caspio Attachment field, "save and add another"
- Refunds: full or partial, dated; reduce turnover in the tax year the refund is paid (cash basis); returned items go back in stock
- eBay CSV import (Transaction report or Orders report): auto-matches items by Custom label/SKU, picks up fees and postage labels, skips orders already imported, preview before saving
- Excel export per tax year: SA103 summary plus Sales, Refunds, Stock purchases, Expenses and Unsold stock sheets
- Dashboard: SA103 breakdown by category, net profit after all expenses, refunds in platform check
- Tax-year figures now worked out from dates (not the stored TaxYear), so refunds land in the right year

## 0.1.1 — 2026-11-26
- Tax year 2025-26 (first filing year) is always available in the tax-year menus, even before records exist
- Platform reporting check can switch calendar year (e.g. 2025)
- SETUP: note that some Caspio accounts use `/integrations/rest/v3` for the REST URL

## 0.1.0 — 2026-11-26
First version.
- Login (users set in `USERS_JSON`), mobile-friendly layout
- Stock purchases with multiple items; bundle cost split equally across items without a set cost
- Personal items (tracked, excluded from business figures)
- Item list with search/filters; status In stock / Listed / Sold / Written off
- Record sales (Vinted, eBay, Other) with postage in/out and platform fees; profit per item
- Dashboard: tax-year SA103 running totals (cash basis), unsold stock at cost, calendar-year platform reporting check
- Caspio REST v3 backend; in-memory backend for local testing; `npm run check-caspio`

### Planned next
- Tax-year lock after filing
- Edit / delete records
- Vinted import if a usable export is available
