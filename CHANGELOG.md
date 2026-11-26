# Changelog

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
- Other expenses (packaging, mileage, phone…) by SA103 category, with receipt photos
- Refunds / returns
- eBay CSV import
- CSV/Excel export per tax year; tax-year lock
