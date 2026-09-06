import assert from "node:assert/strict";
import { calculateBatch, fobTotal, loadRules, lookupCapacity, printingPrice } from "./quote_engine.mjs";

const rules = await loadRules();

function close(actual, expected, tolerance = 1e-9, message = "") {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} expected ${expected}, got ${actual}`);
}

function baseItem(overrides = {}) {
  return {
    line_id: "T1",
    shipment_group: "S1",
    product_name: "测试平口袋",
    bag_type: "flat",
    material: "HDPE",
    width_cm: 30,
    length_cm: 30,
    thickness_mm: 0.03,
    quantity: 50000,
    qty_per_carton: 2500,
    front_colors: 1,
    back_colors: 1,
    print_coverage_pct: 30,
    bag_color: "other",
    plate_count: 2,
    ...overrides,
  };
}

function run(items, batch = {}) {
  return calculateBatch({
    batch: { trade_term: "FOB", port: "Shenzhen", ...batch },
    items,
  }, rules);
}

// User gold example: HDPE 30×30×0.03, two colors.
{
  const item = run([baseItem({ line_id: "G01" })]).items[0];
  close(item.unit_weight_kg, 0.00513, 1e-12, "G01 flat-bag unit weight");
  close(item.bag_type_weight_factor, 1, 1e-12, "G01 flat-bag factor");
  assert.equal(item.capacity.capacity_pcs, 45000);
  close(item.daily_kg_exact, 230.85, 1e-9, "G01 daily kg");
  assert.equal(item.daily_kg_rounded, 231);
  assert.equal(item.processing.cny_per_ton, 2500);
  close(item.printing.unit_cny, 0.0145, 1e-12, "G01 printing");
  close(item.raw_loss_rate, 40 / 256.5, 1e-12, "G01 loss");
}

// Only vest bags apply the 0.95 weight factor.
{
  const item = run([baseItem({ line_id: "G01-VEST", bag_type: "vest" })]).items[0];
  close(item.bag_type_weight_factor, 0.95, 1e-12, "G01 vest-bag factor");
  close(item.unit_weight_kg, 0.0048735, 1e-12, "G01 vest-bag unit weight");
  close(item.daily_kg_exact, 219.3075, 1e-9, "G01 vest daily kg");
}

// Existing workbook gold example.
{
  const item = run([baseItem({
    line_id: "G02",
    width_cm: 37,
    length_cm: 40,
    thickness_mm: 0.02,
    quantity: 1500000,
  })]).items[0];
  close(item.unit_weight_kg, 0.005624, 1e-12, "G02 unit weight");
  assert.equal(item.capacity.capacity_pcs, 40000);
  close(item.daily_kg_exact, 224.96, 1e-9, "G02 daily kg");
  assert.equal(item.processing.cny_per_ton, 2500);
  close(item.loss_multiplier, 1.06, 1e-12, "G02 loss multiplier");
  close(item.printing.unit_cny, 0.016, 1e-12, "G02 printing");
}

// LDPE uses the LD column and 0.184 material factor.
{
  const item = run([baseItem({
    line_id: "G03",
    material: "LDPE",
    width_cm: 37,
    length_cm: 40,
    thickness_mm: 0.02,
    quantity: 1500000,
  })]).items[0];
  close(item.unit_weight_kg, 0.0054464, 1e-12, "G03 unit weight");
  assert.equal(item.capacity.capacity_pcs, 35000);
  close(item.daily_kg_exact, 190.624, 1e-9, "G03 daily kg");
  assert.equal(item.processing.cny_per_ton, 3000);
}

// Thickness above 0.06 uses the 0.06 table then reduction.
{
  const item = run([baseItem({ line_id: "G04", thickness_mm: 0.065 })]).items[0];
  assert.equal(item.capacity.base_capacity_pcs, 50000);
  assert.equal(item.capacity.capacity_pcs, 45000);
  close(item.daily_kg_exact, 500.175, 1e-9, "G04 daily kg");
  assert.equal(item.processing.cny_per_ton, 2000);
  assert.equal(lookupCapacity(baseItem({ thickness_mm: 0.13 }), rules).reduction_factor, 0.6);
  assert.equal(lookupCapacity(baseItem({ thickness_mm: 0.131 }), rules).reduction_factor, 0.5);
}

// Confirmed width/length corrections.
{
  const g05 = run([baseItem({ line_id: "G05", width_cm: 55, length_cm: 87 })]).items[0];
  assert.equal(g05.capacity.capacity_pcs, 10000);
  close(g05.daily_kg_exact, 272.745, 1e-9, "G05 daily kg");
  const g06 = run([baseItem({ line_id: "G06", width_cm: 55, length_cm: 90 })]).items[0];
  assert.equal(g06.capacity.capacity_pcs, 6000);
  const g07 = run([baseItem({ line_id: "G07", width_cm: 55, length_cm: 55, thickness_mm: 0.05 })]).items[0];
  assert.equal(g07.capacity.capacity_pcs, 22000);
  const g08 = run([baseItem({ line_id: "G08", width_cm: 60, length_cm: 80, thickness_mm: 0.05 })]).items[0];
  assert.equal(g08.capacity.capacity_pcs, 13000);
  const g09 = run([baseItem({ line_id: "G09", width_cm: 60, length_cm: 80.1, thickness_mm: 0.05 })]).items[0];
  assert.equal(g09.capacity.capacity_pcs, 10000);
  assert.ok(lookupCapacity(baseItem({ width_cm: 55, length_cm: 85.05 }), rules).error);
  assert.ok(lookupCapacity(baseItem({ width_cm: 50.05, length_cm: 55, thickness_mm: 0.05 }), rules).error);
}

// Printing: low quantity takes the more expensive price; >60 scales; unsupported cases stop.
{
  const p1 = printingPrice({ ...baseItem({ quantity: 20000 }), total_colors: 2 }, rules);
  close(p1.unit_cny, 0.025, 1e-12, "low-quantity startup");
  const p2 = printingPrice({ ...baseItem({ quantity: 40000 }), total_colors: 2 }, rules);
  close(p2.unit_cny, 0.0145, 1e-12, "low-quantity table price still higher");
  const p3 = printingPrice({ ...baseItem({ width_cm: 75, length_cm: 30 }), total_colors: 2 }, rules);
  close(p3.unit_cny, 0.035, 1e-12, ">60 scaling");
  assert.equal(printingPrice({ ...baseItem({ print_coverage_pct: 30.01 }), total_colors: 2 }, rules).manual, true);
  assert.equal(printingPrice({ ...baseItem({ front_colors: 4, back_colors: 3 }), total_colors: 7 }, rules).manual, true);
}

// Loss minimum applies below and above one ton, including no printing.
{
  const large = run([baseItem({ line_id: "L1", quantity: 500000 })]).items[0];
  close(large.loss_multiplier, 1.06, 1e-12, "large-order minimum loss");
  const noPrint = run([baseItem({
    line_id: "L2",
    quantity: 500000,
    front_colors: 0,
    back_colors: 0,
    print_coverage_pct: 0,
    plate_count: 0,
  })]).items[0];
  close(noPrint.loss_multiplier, 1.06, 1e-12, "no-print minimum loss");
  close(noPrint.printing.unit_cny, 0, 1e-12, "no-print price");
}

// FOB exact boundaries.
{
  const cases = [
    [999.99, 1800], [1000, 2000], [2000, 2300], [3000, 2800],
    [5000, 3500], [10000, 4000], [15000, 4500], [24999.99, 4500],
    [25000, 6000], [30000, 7200],
  ];
  for (const [weight, expected] of cases) close(fobTotal(weight, rules), expected, 1e-8, `FOB ${weight}`);
}

// One shipment is charged once and allocated by gross weight.
{
  const result = run([
    baseItem({ line_id: "F1", quantity: 100000, shipment_group: "COMBINED" }),
    baseItem({ line_id: "F2", quantity: 20000, shipment_group: "COMBINED" }),
  ]);
  const [a, b] = result.items;
  close(a.fob_allocated_cny + b.fob_allocated_cny, a.fob_total_cny, 1e-9, "FOB allocation tie-out");
  close(a.fob_allocated_cny / b.fob_allocated_cny, a.gross_weight_kg / b.gross_weight_kg, 1e-9, "FOB gross-weight allocation");
}

// Non-FOB freight and final price remain blank.
{
  const item = run([baseItem({ line_id: "N1" })], { trade_term: "CIF" }).items[0];
  assert.equal(item.status, "运费待填");
  assert.equal(item.freight_cny_per_pc, null);
  assert.equal(item.total_cost_cny_per_pc, null);
  assert.equal(item.selling_cny_per_pc, null);
}

// Explicit ex-factory pricing may ignore packaging and still produce a final USD price.
{
  const raw = baseItem({
    line_id: "EXF-1",
    material: "LDPE",
    front_colors: 1,
    back_colors: 0,
    plate_count: 1,
    ignore_packaging: true,
  });
  delete raw.qty_per_carton;
  const item = run([raw], { trade_term: "EXW", price_basis: "EX_FACTORY" }).items[0];
  assert.equal(item.status, "可报价（出厂价）");
  assert.equal(item.carton_count, 0);
  assert.equal(item.carton_cost_per_pc, 0);
  close(item.gross_weight_kg, item.theoretical_weight_kg, 1e-12, "ignored packaging weight");
  assert.equal(item.freight_cny_per_pc, null);
  close(item.total_cost_cny_per_pc, item.cost_before_freight_per_pc, 1e-12, "ex-factory total");
  assert.ok(item.selling_usd_per_pc > 0);
  assert.ok(item.notes.includes("按用户要求忽略包装成本与包装重量"));
  assert.ok(item.notes.includes("出厂价不含运费"));
}

// Ignoring a paper-roll inner pack must not disable outer-carton cost or weight.
{
  const item = run([baseItem({
    line_id: "EXF-CARTON",
    packaging_note: "纸卷不单独计价；纸箱照常计算",
  })], { trade_term: "EXW", price_basis: "EX_FACTORY" }).items[0];
  assert.equal(item.status, "可报价（出厂价）");
  assert.equal(item.ignore_packaging, false);
  assert.equal(item.carton_count, 20);
  close(item.carton_cost_per_pc, 0.002, 1e-12, "outer-carton cost retained");
  close(item.gross_weight_kg, item.theoretical_weight_kg + 20, 1e-12, "outer-carton tare retained");
  assert.equal(item.packaging_note, "纸卷不单独计价；纸箱照常计算");
  assert.equal(item.freight_cny_per_pc, null);
  assert.ok(item.selling_usd_per_pc > 0);
}

// Missing plate count does not contaminate bag price, but is visibly flagged.
{
  const raw = baseItem({ line_id: "PENDING" });
  delete raw.plate_count;
  const item = run([raw]).items[0];
  assert.equal(item.status, "可报价；铜版块数待确认");
  assert.equal(item.plate_fee_total_cny, null);
  assert.ok(item.selling_cny_per_pc > 0);
}

// Required printing inputs must never default silently to no printing.
{
  const missing = baseItem({ line_id: "MISSING" });
  delete missing.front_colors;
  delete missing.back_colors;
  delete missing.print_coverage_pct;
  const missingResult = run([missing]).items[0];
  assert.equal(missingResult.status, "输入错误");
  const contradictoryNoPrint = run([baseItem({
    line_id: "CONFLICT-1",
    front_colors: 0,
    back_colors: 0,
    print_coverage_pct: 20,
    plate_count: 0,
  })]).items[0];
  assert.equal(contradictoryNoPrint.status, "输入错误");
  const contradictoryPrint = run([baseItem({
    line_id: "CONFLICT-2",
    front_colors: 1,
    back_colors: 0,
    print_coverage_pct: 0,
    plate_count: 1,
  })]).items[0];
  assert.equal(contradictoryPrint.status, "输入错误");
  const zeroPlate = run([baseItem({ line_id: "CONFLICT-3", plate_count: 0 })]).items[0];
  assert.equal(zeroPlate.status, "输入错误");
}

process.stdout.write("polybag-batch-quotation: all self-tests passed\n");
