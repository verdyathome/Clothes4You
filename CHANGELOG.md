# Changelog

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
