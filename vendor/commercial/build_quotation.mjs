import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";
import { calculateCartonDimensions, formatCartonDimensions } from "./carton_dimensions.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (!key || value === undefined) throw new Error(`Invalid argument near ${argv[i] ?? "end"}`);
    args[key] = value;
  }
  return args;
}

function required(value, label) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`Missing required field: ${label}`);
  }
  return value;
}

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be a positive number`);
  return number;
}

function nonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative number`);
  return number;
}

function isoDate(value, label) {
  required(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD`);
  return new Date(`${value}T12:00:00Z`);
}

function merged(sheet, address, value, format = undefined) {
  const range = sheet.getRange(address);
  range.merge();
  range.values = [[value ?? ""]];
  if (format) range.format = format;
  return range;
}

function joinLines(lines) {
  return lines.filter((value) => value !== undefined && value !== null && String(value).trim() !== "").join("\n");
}

function moneyFormat(currency, decimals) {
  const symbols = { USD: "$", CNY: "¥", RMB: "¥", EUR: "€", GBP: "£" };
  const symbol = symbols[String(currency).toUpperCase()];
  const zeros = decimals > 0 ? `.${"0".repeat(decimals)}` : "";
  return symbol ? `"${symbol}"#,##0${zeros}` : `#,##0${zeros}`;
}

const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(required(args.input, "--input"));
const outputPath = path.resolve(required(args.output, "--output"));
const previewPath = args.preview ? path.resolve(args.preview) : null;
const logoPath = args.logo ? path.resolve(args.logo) : null;

const payload = JSON.parse(await fs.readFile(inputPath, "utf8"));
const quote = payload.quote ?? {};
const customer = payload.customer ?? {};
const seller = payload.seller ?? {};
const sample = payload.sample ?? {};
const items = payload.items;

required(quote.quote_no, "quote.quote_no");
required(quote.currency, "quote.currency");
required(quote.price_basis, "quote.price_basis");
required(quote.unit, "quote.unit");
required(customer.company, "customer.company");
required(customer.contact, "customer.contact");
if (!customer.email && !customer.phone) throw new Error("customer.email or customer.phone is required");
required(seller.name, "seller.name");
required(seller.company, "seller.company");
required(seller.email, "seller.email");
const quoteDate = isoDate(quote.date, "quote.date");
const validUntil = isoDate(quote.valid_until, "quote.valid_until");
const allowedPriceTypes = new Set(["FOB", "EXW", "TAX_INCLUDED"]);
if (!allowedPriceTypes.has(quote.price_type)) throw new Error("quote.price_type must be FOB, EXW, or TAX_INCLUDED");
if (!Array.isArray(items) || items.length === 0) throw new Error("items must contain at least one quotation line");

const normalizedItems = items.map((item, index) => {
  const qtyPerCarton = positiveNumber(item.qty_per_carton, `items[${index}].qty_per_carton`);
  const cartonInput = item.carton_calculation;
  const cartonDimensions = cartonInput
    ? calculateCartonDimensions({
        bagWidthCm: cartonInput.bag_width_cm,
        bagLengthCm: cartonInput.bag_length_cm,
        thicknessMm: cartonInput.thickness_mm,
        piecesPerCarton: qtyPerCarton,
      })
    : null;

  return {
    customer_model: item.customer_model ?? "",
    product: required(item.product, `items[${index}].product`),
    size: required(item.size, `items[${index}].size`),
    thickness: required(item.thickness, `items[${index}].thickness`),
    printing: item.printing || "1C1S (1 color, 1 side)",
    quantity: positiveNumber(item.quantity, `items[${index}].quantity`),
    unit_price: nonNegativeNumber(item.unit_price, `items[${index}].unit_price`),
    qty_per_carton: qtyPerCarton,
    gross_weight_kg: positiveNumber(item.gross_weight_kg, `items[${index}].gross_weight_kg`),
    carton_size: cartonDimensions ? formatCartonDimensions(cartonDimensions) : "",
    copper_plate_fee: item.copper_plate_fee ?? null,
    remark: item.remark ?? "",
  };
});

const sampleCost = sample.cost === undefined ? 150 : nonNegativeNumber(sample.cost, "sample.cost");
const sampleCurrency = sample.currency || "USD";
const sampleTime = sample.time || "10–15 days";
if (sample.requested !== undefined && typeof sample.requested !== "boolean") {
  throw new Error("sample.requested must be true or false");
}
const sampleRequested = sample.requested === true;
const sampleBasis = String(sample.basis || "size").trim().replace(/^\/\s*/, "");
required(sampleBasis, "sample.basis");
const sampleRate = `${sampleCurrency} ${sampleCost}/${sampleBasis}`;
const samplePolicy = sampleRequested ? `${sampleRate} (requested)` : `If requested: ${sampleRate}`;
const pricePrecision = Math.min(6, Math.max(0, Number.isInteger(quote.price_precision) ? quote.price_precision : 4));
const priceTypeLabel = quote.price_type === "TAX_INCLUDED" ? "TAX-INCL." : quote.price_type;
const unitLabel = String(quote.unit).toUpperCase();
const currencyLabel = String(quote.currency).toUpperCase();

const plateCharges = normalizedItems.flatMap((item, index) => {
  if (item.copper_plate_fee === null || item.copper_plate_fee === undefined || item.copper_plate_fee === "") return [];
  const fee = typeof item.copper_plate_fee === "number"
    ? { amount: item.copper_plate_fee, currency: quote.currency, remark: "" }
    : item.copper_plate_fee;
  const amount = nonNegativeNumber(fee.amount, `items[${index}].copper_plate_fee.amount`);
  if (amount === 0) return [];
  return [{
    charge: "Copper Plate Fee",
    appliesTo: item.customer_model || item.product,
    amount,
    currency: fee.currency || quote.currency,
    remark: fee.remark || "One-time charge",
  }];
});

const itemStartRow = 14;
const itemEndRow = itemStartRow + normalizedItems.length - 1;
const totalRow = itemEndRow + 1;
const pricingNoteRow = totalRow + 1;
const termsHeaderRow = pricingNoteRow + 2;
const termsStartRow = termsHeaderRow + 1;
const termsEndRow = termsStartRow + 4;
const hasPlateCharges = plateCharges.length > 0;
const chargesHeaderRow = termsEndRow + 2;
const chargesColumnsRow = chargesHeaderRow + 1;
const chargesStartRow = chargesColumnsRow + 1;
const chargesEndRow = hasPlateCharges ? chargesStartRow + plateCharges.length - 1 : termsEndRow;
const notesHeaderRow = hasPlateCharges ? chargesEndRow + 2 : termsEndRow + 2;
const notesBodyRow = notesHeaderRow + 1;
const footerTopRow = notesBodyRow + 2;
const footerBottomRow = footerTopRow + 1;

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("Commercial Quotation");
sheet.showGridLines = false;

const green = "#0B5D31";
const darkGreen = "#064E2B";
const paleGreen = "#E9F1E4";
const softGreen = "#F5F8F3";
const border = "#CBD7C8";
const text = "#1F2933";
const muted = "#52606D";
const amber = "#FFF4CC";
const amberText = "#805B10";
const baseFont = { typeface: "Carlito", fontSize: 10, color: text };

sheet.getRange(`A1:K${footerBottomRow}`).format = {
  font: baseFont,
  verticalAlignment: "center",
};

const columnWidths = { A: 5, B: 13, C: 18, D: 24, E: 12, F: 10, G: 11, H: 13, I: 14, J: 16, K: 12 };
for (const [column, width] of Object.entries(columnWidths)) {
  sheet.getRange(`${column}1:${column}${footerBottomRow}`).format.columnWidth = width;
}

merged(sheet, "A1:K1", "HENGSHENG PLASTIC PACKAGING", {
  font: { ...baseFont, bold: true, fontSize: 22, color: green },
  horizontalAlignment: "center",
});
sheet.getRange("A1:K1").format.rowHeight = 36;

merged(sheet, "G2:K2", "COMMERCIAL QUOTATION", {
  font: { ...baseFont, bold: true, fontSize: 11, color: green },
  horizontalAlignment: "center",
});
merged(sheet, "C3:F3", seller.company, { font: { ...baseFont, bold: true, fontSize: 11 } });
merged(sheet, "C4:F4", "Professional Manufacturer of Custom Plastic Packaging Products", {
  font: { ...baseFont, color: muted },
});

for (const [row, label, value, numberFormat] of [
  [3, "Quote No.", quote.quote_no, null],
  [4, "Date", quoteDate, "mmmm d, yyyy"],
  [5, "Valid Until", validUntil, "mmmm d, yyyy"],
]) {
  merged(sheet, `G${row}:H${row}`, label, {
    font: { ...baseFont, bold: true },
    borders: { bottom: { style: "thin", color: text } },
  });
  merged(sheet, `I${row}:K${row}`, value, {
    horizontalAlignment: "right",
    borders: { bottom: { style: "thin", color: text } },
    ...(numberFormat ? { numberFormat } : {}),
  });
}
sheet.getRange("A6:K6").format = {
  borders: { bottom: { style: "medium", color: green } },
  rowHeight: 7,
};

merged(sheet, "A7:E7", "PREPARED FOR", {
  fill: paleGreen,
  font: { ...baseFont, bold: true, color: green },
  borders: { preset: "outside", style: "thin", color: border },
});
merged(sheet, "F7:K7", "PREPARED BY", {
  fill: paleGreen,
  font: { ...baseFont, bold: true, color: green },
  borders: { preset: "outside", style: "thin", color: border },
});

const customerBlock = joinLines([
  customer.company,
  `Attn: ${customer.contact}`,
  customer.title,
  customer.email ? `Email: ${customer.email}` : "",
  customer.phone ? `Tel: ${customer.phone}` : "",
  customer.address,
]);
const sellerBlock = joinLines([
  `${seller.name}${seller.title ? ` | ${seller.title}` : ""}`,
  seller.company,
  `Email: ${seller.email}`,
  seller.website ? `Website: ${seller.website}` : "",
  seller.phone ? `Tel: ${seller.phone}` : "",
  seller.address,
]);
merged(sheet, "A8:E11", customerBlock, {
  font: baseFont,
  verticalAlignment: "top",
  wrapText: true,
  borders: { preset: "outside", style: "thin", color: border },
});
merged(sheet, "F8:K11", sellerBlock, {
  font: baseFont,
  verticalAlignment: "top",
  wrapText: true,
  borders: { preset: "outside", style: "thin", color: border },
});
sheet.getRange("A8:K11").format.rowHeight = 22;
sheet.getRange("A12:K12").format.rowHeight = 7;

const headers = [
  "ITEM",
  "CUSTOMER MODEL",
  "PRODUCT",
  "SPECIFICATION",
  `QUANTITY (${unitLabel})`,
  `${unitLabel} / CTN`,
  "G.W. / CTN (KG)",
  `${priceTypeLabel} ${currencyLabel} / ${unitLabel}`,
  `AMOUNT (${currencyLabel})`,
  "CARTON SIZE\n(W×L×H CM)",
  "REMARK",
];
sheet.getRange("A13:K13").values = [headers];
sheet.getRange("A13:K13").format = {
  fill: darkGreen,
  font: { ...baseFont, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
  borders: { preset: "all", style: "thin", color: border },
  rowHeight: 42,
};

normalizedItems.forEach((item, index) => {
  const row = itemStartRow + index;
  sheet.getRange(`A${row}:K${row}`).values = [[
    index + 1,
    item.customer_model,
    item.product,
    joinLines([`Size: ${item.size}`, `Thickness: ${item.thickness}`, `Printing: ${item.printing}`]),
    item.quantity,
    item.qty_per_carton,
    item.gross_weight_kg,
    item.unit_price,
    null,
    item.carton_size,
    item.remark,
  ]];
  sheet.getRange(`I${row}`).formulas = [[`=E${row}*H${row}`]];
  sheet.getRange(`A${row}:K${row}`).format = {
    fill: index % 2 === 0 ? "#FFFFFF" : softGreen,
    borders: { preset: "all", style: "thin", color: border },
    verticalAlignment: "center",
    wrapText: true,
    rowHeight: 48,
  };
  sheet.getRange(`A${row}:B${row}`).format.horizontalAlignment = "center";
  sheet.getRange(`E${row}:I${row}`).format.horizontalAlignment = "right";
  sheet.getRange(`J${row}`).format.horizontalAlignment = "center";
  sheet.getRange(`E${row}:F${row}`).format.numberFormat = "#,##0";
  sheet.getRange(`G${row}`).format.numberFormat = "#,##0.00";
  sheet.getRange(`H${row}`).format.numberFormat = moneyFormat(currencyLabel, pricePrecision);
  sheet.getRange(`I${row}`).format.numberFormat = moneyFormat(currencyLabel, 2);
});

merged(sheet, `A${totalRow}:H${totalRow}`, `TOTAL QUOTED GOODS VALUE (${currencyLabel})`, {
  fill: paleGreen,
  font: { ...baseFont, bold: true, color: green },
  borders: { preset: "all", style: "thin", color: border },
});
sheet.getRange(`I${totalRow}`).formulas = [[`=SUM(I${itemStartRow}:I${itemEndRow})`]];
sheet.getRange(`I${totalRow}`).format = {
  fill: paleGreen,
  font: { ...baseFont, bold: true, color: green },
  numberFormat: moneyFormat(currencyLabel, 2),
  horizontalAlignment: "right",
  borders: { preset: "all", style: "thin", color: border },
};
sheet.getRange(`J${totalRow}:K${totalRow}`).format = {
  fill: paleGreen,
  borders: { preset: "all", style: "thin", color: border },
};
sheet.getRange(`A${totalRow}:K${totalRow}`).format.rowHeight = 22;

merged(sheet, `A${pricingNoteRow}:K${pricingNoteRow}`, quote.pricing_note || "Prices apply to the quantities and specifications shown above.", {
  fill: amber,
  font: { ...baseFont, color: amberText },
  wrapText: true,
  borders: { preset: "outside", style: "thin", color: "#E2C15C" },
});
sheet.getRange(`A${pricingNoteRow}:K${pricingNoteRow}`).format.rowHeight = 32;

merged(sheet, `A${termsHeaderRow}:E${termsHeaderRow}`, "COMMERCIAL TERMS", {
  fill: paleGreen,
  font: { ...baseFont, bold: true, color: green },
  borders: { preset: "outside", style: "thin", color: border },
});
merged(sheet, `F${termsHeaderRow}:K${termsHeaderRow}`, "SAMPLE & PACKING", {
  fill: paleGreen,
  font: { ...baseFont, bold: true, color: green },
  borders: { preset: "outside", style: "thin", color: border },
});

const leftTerms = [
  ["Currency", currencyLabel],
  ["Price Term", quote.price_basis],
  ["Payment", quote.payment || "To be confirmed"],
  ["Production Lead Time", quote.production_lead_time || "To be confirmed after sample and specification approval"],
  ["Validity", quote.validity || "30 days from quote date"],
];
const rightTerms = [
  [sampleRequested ? "Custom Sample Charge" : "Custom Sample Policy", samplePolicy],
  ["Sample Time", sampleTime],
  ["Packing", "See item table"],
  ["Carton Gross Weight", "See item table"],
  ["Freight / Duties", quote.freight_duties || "Excluded unless expressly stated"],
];

for (let offset = 0; offset < 5; offset += 1) {
  const row = termsStartRow + offset;
  merged(sheet, `A${row}:B${row}`, leftTerms[offset][0], {
    fill: "#F3F4F6",
    font: { ...baseFont, bold: true },
    borders: { preset: "all", style: "thin", color: border },
  });
  merged(sheet, `C${row}:E${row}`, leftTerms[offset][1], {
    wrapText: true,
    borders: { preset: "all", style: "thin", color: border },
  });
  merged(sheet, `F${row}:G${row}`, rightTerms[offset][0], {
    fill: "#F3F4F6",
    font: { ...baseFont, bold: true },
    borders: { preset: "all", style: "thin", color: border },
  });
  merged(sheet, `H${row}:K${row}`, rightTerms[offset][1], {
    wrapText: true,
    borders: { preset: "all", style: "thin", color: border },
  });
  sheet.getRange(`A${row}:K${row}`).format.rowHeight = offset === 1 || offset === 3 ? 34 : 26;
}

if (hasPlateCharges) {
  merged(sheet, `A${chargesHeaderRow}:K${chargesHeaderRow}`, "COPPER PLATE CHARGES", {
    fill: paleGreen,
    font: { ...baseFont, bold: true, color: green },
    borders: { preset: "outside", style: "thin", color: border },
  });
  sheet.getRange(`A${chargesColumnsRow}:K${chargesColumnsRow}`).values = [[
    "ITEM", "CHARGE", null, null, "APPLIES TO", null, null, "AMOUNT", "CURRENCY", "REMARK", null,
  ]];
  sheet.getRange(`B${chargesColumnsRow}:D${chargesColumnsRow}`).merge();
  sheet.getRange(`E${chargesColumnsRow}:G${chargesColumnsRow}`).merge();
  sheet.getRange(`J${chargesColumnsRow}:K${chargesColumnsRow}`).merge();
  sheet.getRange(`A${chargesColumnsRow}:K${chargesColumnsRow}`).format = {
    fill: darkGreen,
    font: { ...baseFont, bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    borders: { preset: "all", style: "thin", color: border },
    rowHeight: 24,
  };

  plateCharges.forEach((charge, index) => {
    const row = chargesStartRow + index;
    sheet.getRange(`A${row}`).values = [[index + 1]];
    merged(sheet, `B${row}:D${row}`, charge.charge);
    merged(sheet, `E${row}:G${row}`, charge.appliesTo);
    sheet.getRange(`H${row}`).values = [[charge.amount]];
    sheet.getRange(`I${row}`).values = [[charge.currency]];
    merged(sheet, `J${row}:K${row}`, charge.remark);
    sheet.getRange(`A${row}:K${row}`).format = {
      fill: index % 2 === 0 ? "#FFFFFF" : softGreen,
      borders: { preset: "all", style: "thin", color: border },
      wrapText: true,
      rowHeight: 34,
    };
    sheet.getRange(`A${row}`).format.horizontalAlignment = "center";
    sheet.getRange(`H${row}`).format = {
      numberFormat: moneyFormat(charge.currency, 2),
      horizontalAlignment: "right",
    };
    sheet.getRange(`I${row}`).format.horizontalAlignment = "center";
  });
}

merged(sheet, `A${notesHeaderRow}:K${notesHeaderRow}`, "NOTES", {
  fill: paleGreen,
  font: { ...baseFont, bold: true, color: green },
  borders: { preset: "outside", style: "thin", color: border },
});
const notes = Array.isArray(payload.notes) && payload.notes.length > 0
  ? payload.notes
  : [
      "Prices apply only to the specifications shown above.",
      "Final production must follow the approved sample and written specifications.",
      sampleRequested
        ? `The requested custom sample charge (${sampleRate}) is shown under Sample & Packing and excluded from the quoted-goods total.`
        : `Custom samples are optional and charged only when requested at ${sampleRate}; sample time is ${sampleTime}.`,
      "Copper plate charges are excluded from the quoted-goods total unless stated otherwise.",
    ];
merged(sheet, `A${notesBodyRow}:K${notesBodyRow}`, notes.map((note) => `• ${note}`).join("\n"), {
  verticalAlignment: "top",
  wrapText: true,
  borders: { preset: "outside", style: "thin", color: border },
});
sheet.getRange(`A${notesBodyRow}:K${notesBodyRow}`).format.rowHeight = Math.max(48, notes.length * 19);

const footerDetails = [seller.address, seller.email, seller.website].filter(Boolean).join("   |   ");
merged(sheet, `A${footerTopRow}:K${footerTopRow}`, footerDetails, {
  fill: darkGreen,
  font: { ...baseFont, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
});
merged(sheet, `A${footerBottomRow}:K${footerBottomRow}`, "HENGSHENG PACKAGING — We Pack, You Trust.", {
  fill: paleGreen,
  font: { ...baseFont, bold: true, color: green },
  horizontalAlignment: "center",
});
sheet.getRange(`A${footerTopRow}:K${footerTopRow}`).format.rowHeight = 23;
sheet.getRange(`A${footerBottomRow}:K${footerBottomRow}`).format.rowHeight = 20;

if (logoPath) {
  const logoBytes = await fs.readFile(logoPath);
  const dataUrl = `data:image/png;base64,${logoBytes.toString("base64")}`;
  sheet.images.add({
    dataUrl,
    anchor: { from: { row: 0, col: 0, rowOffsetPx: 4, colOffsetPx: 4 }, extent: { widthPx: 62, heightPx: 62 } },
  });
}

const keyRange = `A1:K${footerBottomRow}`;
const check = await workbook.inspect({
  kind: "region",
  sheetId: "Commercial Quotation",
  range: keyRange,
  tableMaxRows: Math.min(80, footerBottomRow),
  tableMaxCols: 11,
  maxChars: 5000,
});
console.log(check.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
if (errors.ndjson.trim()) console.log(errors.ndjson);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
if (previewPath) {
  await fs.mkdir(path.dirname(previewPath), { recursive: true });
  const preview = await workbook.render({
    sheetName: "Commercial Quotation",
    autoCrop: "all",
    scale: 1.5,
    format: "png",
  });
  await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({
  output: outputPath,
  preview: previewPath,
  itemRows: normalizedItems.length,
  plateChargeRows: plateCharges.length,
  sampleRequested,
}));
