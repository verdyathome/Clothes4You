// Excel workbook for one tax year: summary in SA103 categories plus the records behind it.
const ExcelJS = require('exceljs');
const { ukDate } = require('./util');

const GBP = '"£"#,##0.00;[Red]-"£"#,##0.00';

function sheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 14, style: c.money ? { numFmt: GBP } : {} }));
  ws.getRow(1).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  if (rows.length && columns.some((c) => c.money)) {
    const total = {};
    columns.forEach((c, i) => {
      if (i === 0) total[c.key] = 'Total';
      if (c.money) total[c.key] = { formula: `SUM(${ws.getColumn(c.key).letter}2:${ws.getColumn(c.key).letter}${rows.length + 1})` };
    });
    const row = ws.addRow(total);
    row.font = { bold: true };
  }
  return ws;
}

async function buildWorkbook(f, itemsById, version) {
  const wb = new ExcelJS.Workbook();
  wb.creator = `Clothing Portal v${version}`;
  wb.created = new Date();

  // Summary
  const s = wb.addWorksheet('Summary');
  s.columns = [{ width: 52 }, { width: 16, style: { numFmt: GBP } }];
  s.addRow([`Self-employment summary — tax year ${f.taxYear} (${ukDate(f.range.start)} to ${ukDate(f.range.end)})`]).font = { bold: true, size: 13 };
  s.addRow(['Cash basis. Business items only — personal items are excluded.']);
  s.addRow([]);
  s.addRow(['Income']).font = { bold: true };
  s.addRow(['Sales and postage charged to buyers', f.grossSales]);
  s.addRow(['Less refunds paid', -f.refundsTotal]);
  s.addRow(['Turnover', f.turnover]).font = { bold: true };
  s.addRow([]);
  s.addRow(['Allowable expenses']).font = { bold: true };
  f.categories.forEach((c) => s.addRow([c.name, c.amount]));
  s.addRow(['Total allowable expenses', f.totalExpenses]).font = { bold: true };
  s.addRow([]);
  s.addRow(['Net profit (turnover less expenses)', f.profit]).font = { bold: true };
  s.addRow([]);
  s.addRow(['Unsold business stock at cost, as at today (for information)', f.unsoldValue]);
  s.addRow(['Platform fees are included in "Other allowable business expenses"; postage paid in "Phone, fax, stationery and other office costs".']);
  s.addRow(['Check these figures with an accountant or HMRC guidance before filing.']);

  sheet(wb, 'Sales', [
    { header: 'Sale ID', key: 'id', width: 9 }, { header: 'Date', key: 'date', width: 12 }, { header: 'Item', key: 'item', width: 36 },
    { header: 'Channel', key: 'channel', width: 10 }, { header: 'Order ref', key: 'ref', width: 18 },
    { header: 'Sale price', key: 'price', money: true }, { header: 'Postage charged', key: 'bp', money: true },
    { header: 'Platform fee', key: 'fee', money: true }, { header: 'Postage paid', key: 'pc', money: true },
    { header: 'Item cost', key: 'cost', money: true }, { header: 'Refunded', key: 'ref2', width: 10 },
  ], f.sales.map((x) => ({
    id: x.SaleID, date: ukDate(x.SaleDate), item: `#${x.ItemID} ${itemsById.get(x.ItemID)?.Description || ''}`, channel: x.Channel, ref: x.OrderRef,
    price: x.SalePrice, bp: x.BuyerPostage, fee: x.PlatformFee, pc: x.PostageCost, cost: x.ItemCost, ref2: x.Refunded ? 'Yes' : '',
  })));

  sheet(wb, 'Refunds', [
    { header: 'Sale ID', key: 'id', width: 9 }, { header: 'Refund date', key: 'date', width: 12 }, { header: 'Sale date', key: 'sd', width: 12 },
    { header: 'Item', key: 'item', width: 36 }, { header: 'Channel', key: 'channel', width: 10 },
    { header: 'Item returned', key: 'ret', width: 13 }, { header: 'Amount', key: 'amt', money: true },
  ], f.refunds.map((x) => ({
    id: x.SaleID, date: ukDate(x.RefundDate), sd: ukDate(x.SaleDate), item: `#${x.ItemID} ${itemsById.get(x.ItemID)?.Description || ''}`,
    channel: x.Channel, ret: x.ItemReturned ? 'Yes' : 'No', amt: x.RefundAmount,
  })));

  sheet(wb, 'Stock purchases', [
    { header: 'Purchase ID', key: 'id', width: 11 }, { header: 'Date paid', key: 'date', width: 12 }, { header: 'Bought from', key: 'sup', width: 28 },
    { header: 'Source', key: 'src', width: 18 }, { header: 'Paid by', key: 'pay', width: 14 }, { header: 'Items', key: 'n', width: 7 },
    { header: 'Receipt ref', key: 'rr', width: 16 }, { header: 'Total', key: 'tot', money: true },
  ], f.purchases.map((x) => ({
    id: x.PurchaseID, date: ukDate(x.PurchaseDate), sup: x.Supplier, src: x.SourceType, pay: x.PaymentMethod, n: x.ItemCount, rr: x.ReceiptRef, tot: x.TotalCost,
  })));

  sheet(wb, 'Expenses', [
    { header: 'Expense ID', key: 'id', width: 10 }, { header: 'Date paid', key: 'date', width: 12 }, { header: 'Description', key: 'desc', width: 32 },
    { header: 'Type', key: 'type', width: 30 }, { header: 'SA103 category', key: 'cat', width: 40 }, { header: 'Miles', key: 'miles', width: 8 },
    { header: 'Supplier', key: 'sup', width: 18 }, { header: 'Receipt', key: 'rec', width: 9 }, { header: 'Amount', key: 'amt', money: true },
  ], f.expenses.map((x) => ({
    id: x.ExpenseID, date: ukDate(x.ExpenseDate), desc: x.Description, type: x.ExpenseType, cat: x.SA103Category,
    miles: x.Miles || '', sup: x.Supplier, rec: x.Receipt ? 'Yes' : '', amt: x.Amount,
  })));

  sheet(wb, 'Unsold stock', [
    { header: 'Item ID', key: 'id', width: 9 }, { header: 'Description', key: 'desc', width: 36 }, { header: 'Brand', key: 'brand', width: 16 },
    { header: 'Size', key: 'size', width: 8 }, { header: 'Status', key: 'st', width: 10 }, { header: 'Added', key: 'date', width: 12 },
    { header: 'Cost', key: 'cost', money: true },
  ], f.unsold.map((x) => ({ id: x.ItemID, desc: x.Description, brand: x.Brand, size: x.Size, st: x.Status, date: ukDate(x.DateAdded), cost: x.CostAllocated })));

  return wb.xlsx.writeBuffer();
}

module.exports = { buildWorkbook };
