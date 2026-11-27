# Clothing Portal — setup (v0.3.0)

## 1. Create the Caspio tables

Create four tables in Caspio (CSP_Expenses was added in v0.2.0). Field names are case-sensitive and must match exactly.

### CSP_Purchases
| Field | Caspio type | Notes |
|---|---|---|
| PurchaseID | AutoNumber | unique |
| PurchaseDate | Date/Time | date paid |
| Supplier | Text (255) | |
| SourceType | Text (255) | Charity shop, Wholesale / bundle, Vinted, eBay… |
| PaymentMethod | Text (255) | |
| TotalCost | Number | £, 2 dp |
| ItemCount | Integer | |
| ReceiptRef | Text (255) | |
| Notes | Text (64000) | |
| TaxYear | Text (255) | e.g. `2026-27`, set by the app |
| CreatedBy | Text (255) | login name |

### CSP_Items
| Field | Caspio type | Notes |
|---|---|---|
| ItemID | AutoNumber | unique |
| Description | Text (255) | |
| Brand | Text (255) | |
| Size | Text (255) | |
| Category | Text (255) | |
| Condition | Text (255) | |
| Ownership | Text (255) | `Business` or `Personal` |
| PurchaseID | Integer | blank for personal items |
| CostAllocated | Number | share of the purchase cost, 0 for personal |
| Status | Text (255) | `In stock`, `Listed`, `Sold`, `Written off` |
| ListedOn | Text (255) | Vinted / eBay / Other |
| DateAdded | Date/Time | |
| Notes | Text (64000) | |
| CreatedBy | Text (255) | |

### CSP_Sales
| Field | Caspio type | Notes |
|---|---|---|
| SaleID | AutoNumber | unique |
| ItemID | Integer | |
| SaleDate | Date/Time | date the money was received |
| Channel | Text (255) | Vinted / eBay / Other |
| OrderRef | Text (255) | |
| SalePrice | Number | |
| BuyerPostage | Number | postage charged to the buyer (counts as turnover) |
| PlatformFee | Number | |
| PostageCost | Number | postage she paid |
| Ownership | Text (255) | copied from the item |
| ItemCost | Number | copied from the item |
| TaxYear | Text (255) | set by the app |
| Refunded | Yes/No | set when a refund is recorded |
| RefundDate | Date/Time | date the refund was paid *(v0.2.0)* |
| RefundAmount | Number | *(v0.2.0)* |
| ItemReturned | Yes/No | item came back into stock *(v0.2.0)* |
| Notes | Text (64000) | |
| CreatedBy | Text (255) | |

### CSP_Expenses *(v0.2.0)*
| Field | Caspio type | Notes |
|---|---|---|
| ExpenseID | AutoNumber | unique |
| ExpenseDate | Date/Time | date paid |
| Description | Text (255) | |
| ExpenseType | Text (255) | e.g. Packaging, Mileage |
| SA103Category | Text (255) | set by the app from the type |
| Amount | Number | |
| Miles | Number | mileage claims only (45p/mile) |
| Supplier | Text (255) | |
| PaymentMethod | Text (255) | |
| TaxYear | Text (255) | set by the app |
| Receipt | Attachment | photo or PDF |
| Notes | Text (64000) | |
| CreatedBy | Text (255) | |

`caspio/CSP_Expenses.csv` can be imported to create it — then set the types above, add `ExpenseID` (AutoNumber) and `Receipt` (Attachment), and delete the sample row.

### CSP_Settings *(v0.3.0)*
| Field | Caspio type | Notes |
|---|---|---|
| SettingID | AutoNumber | unique |
| SettingKey | Text (255) | unique — AppName, Accent, AccentInk, Bg, Card, HeaderBg, Ink, Favicon, FaviconType |
| SettingValue | Text (64000) | the favicon is stored here as base64 (max 45 KB image) |

Until this table exists the app runs on its default name and colours, and saving settings shows an error.

Optional: add indexes on `TaxYear` (Purchases, Sales) and `Status` (Items).

## 2. Create a Caspio Web Services profile

1. Caspio → **Access Permissions → Web Services Profiles → New Profile**.
2. Give it **Read, Insert and Update** on all four CSP_ tables (no Delete needed). Include CSP_Expenses so receipt uploads work.
3. Open the profile and copy the **Client ID**, **Client Secret**, **Token Endpoint URL** and the **REST API v3 Integration URL**.
   - Token URL looks like `https://c1xxxxxx.caspio.com/oauth/token`
   - REST URL looks like `https://c1xxxxxx.caspio.com/rest/v3` or, on newer accounts, `https://c1xxxxxx.caspio.com/integrations/rest/v3`. Check by opening `…/integrations/rest/swagger` in a browser: if it loads, use the `/integrations/rest/v3` form. A 404 with an empty body from the app means this URL is wrong.

## 3. Try it locally (optional)

```bash
npm install
npm run dev          # in-memory test data, login admin / admin, http://localhost:3000
```

To test against Caspio locally, copy `.env.example` to `.env`, fill it in, then:

```bash
set -a; source .env; set +a
npm run check-caspio   # checks connection + field names
npm start
```

## 4. Deploy on Railway

1. Put the folder in a GitHub repo (or use `railway up` from the Railway CLI).
2. Railway → **New Project → Deploy from GitHub repo**. Railway detects Node and runs `npm start`.
3. **Variables** tab — add:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | a long random string (40+ characters) |
| `USERS_JSON` | `{"simon":"long-password-1","<her-username>":"long-password-2"}` |
| `CASPIO_TOKEN_URL` | from step 2 |
| `CASPIO_REST_URL` | from step 2 |
| `CASPIO_CLIENT_ID` | from step 2 |
| `CASPIO_CLIENT_SECRET` | from step 2 |

4. **Settings → Networking → Generate Domain** to get the public URL. Railway provides HTTPS.
5. Check `https://<your-domain>/health` returns `{"ok":true,"version":"0.1.0"}`, then log in.

All data lives in Caspio, so redeploying or restarting on Railway never loses records.

## How the figures work

- **Tax year** = 6 April to 5 April. Each purchase and sale is stamped with its tax year from its date.
- **Turnover** = business sale prices + postage charged to buyers, in the tax year the sale is dated (cash basis).
- **Cost of goods** = stock purchases *paid* in the tax year (cash basis), not the cost of items sold. Profit per item is shown separately for her own interest.
- **Personal items** are recorded but left out of all SA103 figures. They do appear in the calendar-year platform check, because Vinted and eBay include them in what they report to HMRC.
