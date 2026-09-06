import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { calculateBatch, loadRules } from "./quote_engine.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATE = path.resolve(SCRIPT_DIR, "../assets/报价模版.xlsx");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`无效参数：${key ?? ""}`);
    args[key.slice(2)] = value;
  }
  return args;
}

async function loadArtifactTool(nodeModulesPath) {
  let resolver;
  if (nodeModulesPath) {
    const moduleRoot = path.resolve(nodeModulesPath);
    resolver = createRequire(pathToFileURL(path.join(moduleRoot, "__resolver.cjs")));
  } else {
    resolver = createRequire(import.meta.url);
  }
  let resolved;
  try {
    resolved = resolver.resolve("@oai/artifact-tool");
  } catch (error) {
    throw new Error("找不到@oai/artifact-tool；请传入--node-modules（由工作区依赖工具返回）", { cause: error });
  }
  return import(pathToFileURL(resolved).href);
}

function setValue(sheet, address, value) {
  sheet.getRange(address).values = [[value ?? null]];
}

function setFormula(sheet, address, formula) {
  sheet.getRange(address).formulas = [[formula]];
}

function clearValue(sheet, address) {
  sheet.getRange(address).clear({ applyTo: "contents" });
}

function styleQuoteSheet(sheet) {
  const all = sheet.getRange("A1:G23");
  all.format.font = { name: "Microsoft YaHei", size: 10, color: "#1F2937" };
  all.format.verticalAlignment = "center";
  sheet.showGridLines = false;

  sheet.getRange("A:A").format.columnWidth = 23;
  sheet.getRange("B:B").format.columnWidth = 18;
  sheet.getRange("C:C").format.columnWidth = 19;
  sheet.getRange("D:D").format.columnWidth = 19;
  sheet.getRange("E:E").format.columnWidth = 23;
  sheet.getRange("F:F").format.columnWidth = 20;
  sheet.getRange("G:G").format.columnWidth = 23;
  sheet.getRange("1:1").format.rowHeight = 30;
  sheet.getRange("11:12").format.rowHeight = 30;
  sheet.getRange("14:14").format.rowHeight = 42;
  sheet.getRange("19:21").format.rowHeight = 32;

  sheet.getRange("A1:E1").format = {
    fill: "#E2F0D9",
    font: { name: "Microsoft YaHei", size: 13, bold: true, color: "#1F4E3D" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
  sheet.getRange("A2:G3").format.borders = { preset: "all", style: "thin", color: "#7F8C8D" };
  sheet.getRange("A2:G2").format = {
    fill: "#F3F4F6",
    font: { name: "Microsoft YaHei", size: 10, bold: true, color: "#374151" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
  };
  sheet.getRange("A3:D3").format.fill = "#FFF2CC";
  sheet.getRange("F3").format.fill = "#FFF2CC";
  sheet.getRange("E3").format = {
    fill: "#008000",
    font: { name: "Microsoft YaHei", size: 10, bold: true, color: "#FFFFFF" },
  };
  sheet.getRange("G2:G3").format.fill = "#FFF200";

  sheet.getRange("A4:D4").format = {
    fill: "#F8FAFC",
    font: { name: "Microsoft YaHei", size: 9, color: "#475569" },
    borders: { preset: "all", style: "thin", color: "#D1D5DB" },
  };

  sheet.getRange("D5:G7").format.borders = { preset: "all", style: "thin", color: "#7F8C8D" };
  sheet.getRange("D5:D7").format = {
    fill: "#F3F4F6",
    font: { name: "Microsoft YaHei", size: 10, bold: true, color: "#374151" },
  };
  sheet.getRange("A7:B20").format.borders = { preset: "all", style: "thin", color: "#4B5563" };
  sheet.getRange("A7:A20").format = {
    fill: "#F3F4F6",
    font: { name: "Microsoft YaHei", size: 10, bold: true, color: "#111827" },
  };
  sheet.getRange("B13:B16").format.fill = "#FFF200";
  sheet.getRange("B20").format.fill = "#FFF200";
  sheet.getRange("B17:B19").format.font = { name: "Microsoft YaHei", size: 10, bold: true, color: "#111827" };

  sheet.getRange("D8:G20").format.borders = { preset: "all", style: "thin", color: "#D1D5DB" };
  sheet.getRange("D8:D12").format = {
    fill: "#EAF2F8",
    font: { name: "Microsoft YaHei", size: 9, bold: true, color: "#1F4E78" },
  };
  sheet.getRange("D15:D20").format = {
    fill: "#EAF2F8",
    font: { name: "Microsoft YaHei", size: 9, bold: true, color: "#1F4E78" },
  };
  sheet.getRange("D13:D14").format = {
    fill: "#FFF2CC",
    font: { name: "Microsoft YaHei", size: 9, bold: true, color: "#7F6000" },
  };
  sheet.getRange("E8:G20").format.wrapText = true;
  sheet.getRange("C14").format.wrapText = true;
  sheet.getRange("E19:G19").format.font = { name: "Microsoft YaHei", size: 10, bold: true, color: "#9C0006" };
  sheet.getRange("A22:G23").format = {
    fill: "#F8FAFC",
    font: { name: "Microsoft YaHei", size: 9, color: "#64748B" },
  };

  sheet.getRange("A3:B3").format.numberFormat = "0.0";
  sheet.getRange("C3:D3").format.numberFormat = "0.000";
  sheet.getRange("B4:D4").format.numberFormat = "0.00";
  sheet.getRange("E3:E4").format.numberFormat = "0.0000000";
  sheet.getRange("F3").format.numberFormat = "#,##0";
  sheet.getRange("G3").format.numberFormat = "#,##0.000";
  sheet.getRange("E5:F5").format.numberFormat = "#,##0";
  sheet.getRange("E6:G6").format.numberFormat = "#,##0.000";
  sheet.getRange("B7:B10").format.numberFormat = "#,##0.00";
  sheet.getRange("B11").format.numberFormat = "0.000000";
  sheet.getRange("B12").format.numberFormat = "0.0000000";
  sheet.getRange("B13:B17").format.numberFormat = "0.000000";
  sheet.getRange("B18").format.numberFormat = "0.00";
  sheet.getRange("B19:B20").format.numberFormat = "0.00000";
  sheet.getRange("C19").format.numberFormat = "0.000000";
  sheet.getRange("C8").format.numberFormat = "#,##0.000";
  sheet.getRange("C11").format.numberFormat = "0.000000";
  sheet.getRange("D13:D14").format.numberFormat = "#,##0.00";
  sheet.getRange("B21").format.numberFormat = "#,##0.00";
  sheet.getRange("E16:E18").format.numberFormat = "#,##0.00";
}

function populateQuoteSheet(sheet, item, metadata, index) {
  setValue(sheet, "A1", `内部报价计算｜${item.line_id}｜${item.product_name}`);
  setValue(sheet, "A3", item.width_cm);
  setValue(sheet, "B3", item.length_cm);
  setValue(sheet, "C3", item.thickness_mm);
  setValue(sheet, "D3", item.material_factor ?? null);
  setValue(sheet, "F3", item.quantity);
  setFormula(
    sheet,
    "E3",
    item.bag_type === "vest"
      ? "=A3*B3*C3*D3/1000*0.95"
      : "=A3*B3*C3*D3/1000",
  );
  setFormula(sheet, "E4", "=E3");
  setFormula(sheet, "G3", "=F3*E4");

  sheet.getRange("A5:C6").clear({ applyTo: "contents" });
  clearValue(sheet, "C7");
  if (item.ignore_packaging) {
    setValue(sheet, "A4", "包装处理");
    setValue(sheet, "B4", "本次忽略");
    setValue(sheet, "C4", "包装成本/重量");
    setValue(sheet, "D4", 0);
    setValue(sheet, "D5", "包装：");
    setValue(sheet, "E5", "全部包装（不计）");
    clearValue(sheet, "F5");
    setValue(sheet, "D6", "产品重量：");
    clearValue(sheet, "E6");
    clearValue(sheet, "F6");
    setFormula(sheet, "G6", "=G3");
    setValue(sheet, "D7", "包装说明：");
    setValue(sheet, "E7", "按用户要求不计成本与重量");
  } else {
    setValue(sheet, "A4", "纸箱元/箱");
    setValue(sheet, "B4", item.carton_cost_cny);
    setValue(sheet, "C4", "纸箱皮重kg");
    setValue(sheet, "D4", item.carton_tare_kg);
    setValue(sheet, "D5", "每箱个数：");
    setValue(sheet, "E5", item.qty_per_carton);
    setValue(sheet, "F5", item.carton_count ?? null);
    setValue(sheet, "D6", "每箱净重：");
    setFormula(sheet, "E6", "=E4*E5");
    setFormula(sheet, "F6", `=E6+${item.carton_tare_kg}`);
    setFormula(sheet, "G6", `=G3+F5*${item.carton_tare_kg}`);
    setValue(sheet, "D7", "箱规：");
    setValue(sheet, "E7", item.packaging_note ?? "待人工填写");
  }

  setValue(sheet, "B7", item.raw_material_cny_per_ton);
  if (item.processing?.cny_per_ton !== undefined) setValue(sheet, "B8", item.processing.cny_per_ton);
  else clearValue(sheet, "B8");
  if (item.capacity?.capacity_pcs !== undefined) setFormula(sheet, "C8", `=${item.capacity.capacity_pcs}*E4`);
  else clearValue(sheet, "C8");
  setValue(sheet, "B9", item.color_rate_cny_per_ton);
  setValue(sheet, "B10", item.additive_cny_per_ton);
  setFormula(sheet, "C11", `=IF(G3<1000,(20+10*${item.total_colors})/G3,(${item.total_colors}+2)/100)`);
  setFormula(sheet, "B11", "=1+MAX(C11,0.06)");
  setFormula(sheet, "B12", "=E4");
  if (item.processing?.cny_per_ton !== undefined) {
    setFormula(sheet, "B13", "=(B7+B8+B9+B10)/1000*B11*B12");
  } else {
    clearValue(sheet, "B13");
  }
  if (item.printing?.unit_cny !== undefined) setValue(sheet, "B14", item.printing.unit_cny);
  else clearValue(sheet, "B14");
  setValue(sheet, "C14", item.printing?.rule_text ?? item.printing?.reason ?? "需人工确认");
  if (item.ignore_packaging) setValue(sheet, "B15", 0);
  else setFormula(sheet, "B15", `=${item.carton_cost_cny}/E5`);
  setValue(sheet, "A16", "运费：");
  if (item.freight_cny_per_pc !== null) setValue(sheet, "B16", item.freight_cny_per_pc);
  else clearValue(sheet, "B16");

  setValue(sheet, "B18", item.markup_multiplier);
  const priceReady = item.total_cost_cny_per_pc !== null;
  if (priceReady) {
    setFormula(sheet, "B17", "=SUM(B13:B16)");
    setFormula(sheet, "B19", "=B17*B18");
    setFormula(sheet, "C19", `=B19/${item.fx_cny_per_usd}`);
    setFormula(sheet, "B20", `=B19*${item.tax_multiplier}`);
  } else {
    for (const address of ["B17", "B19", "C19", "B20"]) clearValue(sheet, address);
  }

  setFormula(sheet, "D13", "=A3*B3*0.18");
  setFormula(sheet, "D14", "=MAX(D13,400)");
  setValue(sheet, "E13", "铜版基础：宽×长×0.18");
  setValue(sheet, "E14", "铜版单块：最低400元");
  if (item.total_colors === 0) {
    setValue(sheet, "B21", 0);
    setValue(sheet, "C21", "无印刷");
  } else if (item.plate_count_pending) {
    setFormula(sheet, "B21", "=D14");
    setValue(sheet, "C21", "单块费用；铜版块数待确认");
  } else {
    setFormula(sheet, "B21", `=D14*${item.plate_count}`);
    setValue(sheet, "C21", `${item.plate_count}块，总费；不计入袋子单价`);
  }

  setValue(sheet, "D8", "产能/班(pcs)");
  setValue(sheet, "E8", item.capacity?.capacity_pcs ?? null);
  setValue(sheet, "D9", "加工日产kg");
  setValue(sheet, "E9", item.daily_kg_exact ?? null);
  setValue(sheet, "D10", "加工费档");
  setValue(sheet, "E10", item.processing?.tier_text ?? "需人工确认");
  setValue(sheet, "D11", "产能规则");
  setValue(sheet, "E11", item.capacity?.rule_text ?? item.capacity?.error ?? "未命中");
  setValue(sheet, "D12", "损耗");
  setValue(sheet, "E12", `原始${(item.raw_loss_rate ?? 0) * 100}%；按${(item.loss_rate ?? 0) * 100}%`);
  setValue(sheet, "D15", "计价方式");
  setValue(
    sheet,
    "E15",
    item.price_basis === "EX_FACTORY"
      ? `出厂美元价（不含运费）`
      : `${item.trade_term} ${item.port}`.trim(),
  );
  setValue(sheet, "D16", "出货组毛重kg");
  setValue(sheet, "E16", item.shipment_group_gross_weight_kg ?? null);
  setValue(sheet, "D17", "FOB总费CNY");
  setValue(sheet, "E17", item.fob_total_cny ?? null);
  setValue(sheet, "D18", "本规格分摊CNY");
  setValue(sheet, "E18", item.fob_allocated_cny ?? null);
  setValue(sheet, "D19", "状态");
  setValue(sheet, "E19", item.status);
  setValue(sheet, "D20", "备注");
  setValue(sheet, "E20", item.notes.join("；"));
  setValue(sheet, "A22", "规则版本");
  setValue(sheet, "B22", metadata.rules_version);
  setValue(sheet, "D22", "规格序号");
  setValue(sheet, "E22", index + 1);
  setValue(sheet, "A23", "报价编号");
  setValue(sheet, "B23", metadata.quote_id || "未填写");
  setValue(sheet, "D23", "客户");
  setValue(sheet, "E23", metadata.customer || "未填写");

  styleQuoteSheet(sheet);
}

function createSummary(workbook, results, quoteSheetNames) {
  const sheet = workbook.worksheets.add("批量汇总");
  sheet.showGridLines = false;
  const headers = [
    "序号", "报价页", "规格", "材料", "尺寸cm", "厚mm", "数量pcs", "单重kg",
    "日产kg", "加工元/吨", "损耗率", "印刷元/个", "毛重kg", "FOB元/个",
    "总成本元/个", "含利CNY", "USD", "含税CNY", "铜版一次费", "状态", "备注"
  ];
  setValue(sheet, "A1", "塑料袋批量内部报价汇总");
  sheet.getRange("A2:H2").values = [[
    "报价编号", results.metadata.quote_id || "未填写",
    "客户", results.metadata.customer || "未填写",
    "规则版本", results.metadata.rules_version,
    "生成时间", `${results.metadata.generated_at.replace("T", " ").slice(0, 19)} UTC`,
  ]];
  sheet.getRangeByIndexes(3, 0, 1, headers.length).values = [headers];

  const rows = results.items.map((item, index) => [
    index + 1,
    quoteSheetNames[index],
    item.product_name,
    item.material,
    `${item.width_cm}×${item.length_cm}`,
    item.thickness_mm,
    item.quantity,
    item.unit_weight_kg ?? null,
    item.daily_kg_exact ?? null,
    item.processing?.cny_per_ton ?? null,
    item.loss_rate ?? null,
    item.printing?.unit_cny ?? null,
    item.gross_weight_kg ?? null,
    item.freight_cny_per_pc ?? null,
    item.total_cost_cny_per_pc ?? null,
    item.selling_cny_per_pc ?? null,
    item.selling_usd_per_pc ?? null,
    item.selling_cny_tax_included_per_pc ?? null,
    item.plate_fee_total_cny ?? null,
    item.status,
    item.notes.join("；"),
  ]);
  if (rows.length) sheet.getRangeByIndexes(4, 0, rows.length, headers.length).values = rows;

  const lastRow = 4 + rows.length;
  const used = sheet.getRange(`A1:U${lastRow}`);
  used.format.font = { name: "Microsoft YaHei", size: 10, color: "#1F2937" };
  used.format.verticalAlignment = "center";
  sheet.getRange("A1:U1").format = {
    fill: "#1F4E78",
    font: { name: "Microsoft YaHei", size: 15, bold: true, color: "#FFFFFF" },
  };
  sheet.getRange("A2:H2").format = {
    fill: "#D9EAF7",
    font: { name: "Microsoft YaHei", size: 10, bold: true, color: "#1F4E78" },
  };
  sheet.getRange("A4:U4").format = {
    fill: "#5B9BD5",
    font: { name: "Microsoft YaHei", size: 9, bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: "#D1D5DB" },
  };
  if (rows.length) {
    sheet.getRange(`A5:U${lastRow}`).format.borders = { preset: "all", style: "thin", color: "#E5E7EB" };
    sheet.getRange(`A5:T${lastRow}`).format.verticalAlignment = "center";
    sheet.getRange(`U5:U${lastRow}`).format.wrapText = true;
    for (let index = 0; index < rows.length; index += 1) {
      const rowNumber = 5 + index;
      const status = results.items[index].status;
      const fill = status.startsWith("可报价") ? "#E2F0D9" : status === "运费待填" ? "#FFF2CC" : "#FCE4D6";
      sheet.getRange(`T${rowNumber}`).format = {
        fill,
        font: { name: "Microsoft YaHei", size: 10, bold: true, color: "#7F6000" },
      };
    }
  }
  sheet.getRange("H:H").format.numberFormat = "0.0000000";
  sheet.getRange("I:I").format.numberFormat = "#,##0.000";
  sheet.getRange("J:J").format.numberFormat = "#,##0";
  sheet.getRange("K:K").format.numberFormat = "0.00%";
  sheet.getRange("L:L").format.numberFormat = "0.000000";
  sheet.getRange("M:M").format.numberFormat = "#,##0.000";
  sheet.getRange("N:R").format.numberFormat = "0.000000";
  sheet.getRange("S:S").format.numberFormat = "#,##0.00";
  sheet.getRange("A:A").format.columnWidth = 7;
  sheet.getRange("B:B").format.columnWidth = 12;
  sheet.getRange("C:C").format.columnWidth = 25;
  sheet.getRange("D:F").format.columnWidth = 11;
  sheet.getRange("G:G").format.columnWidth = 14;
  sheet.getRange("H:S").format.columnWidth = 14;
  sheet.getRange("T:T").format.columnWidth = 22;
  sheet.getRange("U:U").format.columnWidth = 45;
  sheet.getRange("H2").format.numberFormat = "@";
  sheet.getRange("1:1").format.rowHeight = 30;
  sheet.getRange("4:4").format.rowHeight = 34;
  sheet.freezePanes.freezeRows(4);
  sheet.freezePanes.freezeColumns(3);
  return sheet;
}

export async function buildBase(input){
const rules=await loadRules();
const results = calculateBatch(input, rules);
const { FileBlob, SpreadsheetFile } = await loadArtifactTool(undefined);
const blob = await FileBlob.load(DEFAULT_TEMPLATE);
const workbook = await SpreadsheetFile.importXlsx(blob);
const masterSheet = workbook.worksheets.getItemAt(0);
const quoteSheetNames = [];

for (let index = 0; index < results.items.length; index += 1) {
  let sheet;
  if (index === 0) {
    sheet = masterSheet;
  } else {
    const name = `报价${String(index + 1).padStart(3, "0")}`;
    sheet = workbook.worksheets.add(name);
    sheet.getRange("A1:G23").copyFrom(masterSheet.getRange("A1:G23"), "all");
    sheet.mergeCells("A1:E1");
  }
  quoteSheetNames.push(index === 0 ? "Sheet1" : `报价${String(index + 1).padStart(3, "0")}`);
  populateQuoteSheet(sheet, results.items[index], results.metadata, index);
}

createSummary(workbook, results, quoteSheetNames);
return {workbook,results,quoteSheetNames};
}
