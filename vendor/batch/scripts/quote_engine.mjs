import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RULES_PATH = path.resolve(SCRIPT_DIR, "../references/rules.json");

export async function loadRules(rulesPath = DEFAULT_RULES_PATH) {
  return JSON.parse(await fs.readFile(rulesPath, "utf8"));
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value) {
  return isFiniteNumber(value) && value > 0;
}

function nonNegative(value) {
  return isFiniteNumber(value) && value >= 0;
}

function integer(value) {
  return Number.isInteger(value);
}

function pick(item, batch, defaults, key) {
  return item[key] ?? batch[key] ?? defaults[key];
}

function normalizeBagType(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (["flat", "flat bag", "平口袋", "平口"].includes(text)) return "flat";
  if (["vest", "vest bag", "背心袋", "背心"].includes(text)) return "vest";
  return text;
}

function normalizeBagColor(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (["transparent", "clear", "透明", "透明色"].includes(text)) return "transparent";
  if (["black", "黑", "黑色"].includes(text)) return "black";
  if (["white", "白", "白色"].includes(text)) return "white";
  if (["other", "color", "coloured", "colored", "其他", "彩色", "其它颜色", "其他颜色"].includes(text)) return "other";
  return text;
}

function normalizeTradeTerm(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizePriceBasis(value, tradeTerm) {
  const text = String(value ?? "").trim().toUpperCase().replace(/[ -]/g, "_");
  if (["EX_FACTORY", "FACTORY", "出厂", "出厂价"].includes(text)) return "EX_FACTORY";
  if (!text && tradeTerm === "EXW") return "EX_FACTORY";
  return text || "TRADE_TERM";
}

function normalizePort(value) {
  return String(value ?? "").trim().toLowerCase();
}

function matchesRange(value, min, minInclusive, max, maxExclusive) {
  const aboveMin = min === null || min === undefined
    ? true
    : minInclusive
      ? value >= min
      : value > min;
  const belowMax = max === null || max === undefined
    ? true
    : maxExclusive
      ? value < max
      : value <= max;
  return aboveMin && belowMax;
}

function thicknessTable(thicknessMm) {
  if (thicknessMm >= 0.011 && thicknessMm < 0.015) return "t1";
  if (thicknessMm >= 0.015 && thicknessMm < 0.025) return "t2";
  if (thicknessMm >= 0.025 && thicknessMm < 0.04) return "t3";
  if (thicknessMm >= 0.04) return "t4";
  return null;
}

function capacityReduction(thicknessMm, rules) {
  if (thicknessMm <= 0.06) return 1;
  const tier = rules.thick_capacity_reduction.find((row) => (
    thicknessMm > row.min_exclusive_mm
    && (row.max_inclusive_mm === null || thicknessMm <= row.max_inclusive_mm)
  ));
  return tier?.factor ?? null;
}

export function lookupCapacity(item, rules) {
  const tableKey = thicknessTable(item.thickness_mm);
  if (!tableKey) {
    return { error: "厚度低于0.011mm或不在已确认产能表范围" };
  }

  let lookupWidth = item.width_cm;
  let lookupLength = item.length_cm;
  const adjustments = [];

  if (
    tableKey === "t3"
    && item.width_cm > 50
    && item.length_cm >= 85.1
    && item.length_cm <= 89.9
  ) {
    lookupLength = 85;
    adjustments.push("长85.1–89.9cm按85cm档");
  }

  if (tableKey === "t4" && item.width_cm >= 50.1 && item.width_cm <= 59.9) {
    lookupWidth = 50;
    adjustments.push("宽50.1–59.9cm按50cm档");
  }

  const table = rules.capacity_tables[tableKey];
  const row = table.rows.find((candidate) => (
    matchesRange(
      lookupWidth,
      candidate.wmin,
      candidate.wmin_inc === true,
      candidate.wmax,
      candidate.wmax_exc === true,
    )
    && matchesRange(
      lookupLength,
      candidate.lmin,
      candidate.lmin_inc === true,
      candidate.lmax,
      candidate.lmax_exc === true,
    )
  ));

  if (!row) {
    return {
      error: `尺寸未命中产能表：${table.label}，宽${item.width_cm}cm，长${item.length_cm}cm`,
      table_key: tableKey,
      table_label: table.label,
      adjustments,
    };
  }

  const materialRule = rules.materials[item.material];
  const baseCapacity = row[materialRule.capacity_column];
  const reduction = capacityReduction(item.thickness_mm, rules);
  if (reduction === null) return { error: "厚度降产能规则缺失" };

  const capacity = baseCapacity * reduction;
  const rangeText = [
    `厚度表=${table.label}`,
    `宽=${row.wmin}${row.wmin_inc ? "≤" : "<"}W${row.wmax === null ? "" : `${row.wmax_exc ? "<" : "≤"}${row.wmax}`}`,
    `长=${row.lmin}${row.lmin_inc ? "≤" : "<"}L${row.lmax === null ? "" : `${row.lmax_exc ? "<" : "≤"}${row.lmax}`}`,
    `列=${materialRule.capacity_column.toUpperCase()}`,
    `基础=${baseCapacity}pcs`,
    reduction === 1 ? null : `降产能${Math.round((1 - reduction) * 100)}%`,
    adjustments.length ? adjustments.join("；") : null,
  ].filter(Boolean).join("；");

  return {
    capacity_pcs: capacity,
    base_capacity_pcs: baseCapacity,
    reduction_factor: reduction,
    table_key: tableKey,
    table_label: table.label,
    adjustments,
    rule_text: rangeText,
  };
}

export function processingFee(dailyKgRounded, rules) {
  const tier = rules.processing_fee_tiers.find((row) => (
    dailyKgRounded >= row.min_kg
    && (row.max_kg_exclusive === null || dailyKgRounded < row.max_kg_exclusive)
  ));
  if (!tier) return null;
  return {
    cny_per_kg: tier.cny_per_kg,
    cny_per_ton: tier.cny_per_kg * 1000,
    tier_text: tier.max_kg_exclusive === null
      ? `${tier.min_kg}kg以上 → ${tier.cny_per_kg}元/kg`
      : `${tier.min_kg}–${tier.max_kg_exclusive}kg → ${tier.cny_per_kg}元/kg`,
  };
}

function startupFee(colors, rules) {
  return rules.printing.startup_fees.find(
    (row) => colors >= row.min_colors && colors <= row.max_colors,
  )?.cny ?? null;
}

export function printingPrice(item, rules) {
  const colors = item.total_colors;
  if (colors === 0) {
    return {
      unit_cny: 0,
      table_unit_cny: 0,
      startup_fee_cny: 0,
      rule_text: "无印刷",
    };
  }
  if (item.print_coverage_pct > rules.printing.max_coverage_pct) {
    return { manual: true, reason: "印刷面积超过30%，需人工核价" };
  }
  if (colors > 6) {
    return { manual: true, reason: "印刷超过6色，需人工核价" };
  }

  const size = Math.max(item.width_cm, item.length_cm);
  let tableUnit;
  let sizeRule;
  const band = rules.printing.size_bands.find((row) => size <= row.max_cm);
  if (band) {
    tableUnit = band.prices[colors - 1];
    sizeRule = `最大尺寸${size}cm，≤${band.max_cm}cm档`;
  } else {
    const base = rules.printing.over_60_base_prices[colors - 1];
    tableUnit = base / 60 * size;
    sizeRule = `最大尺寸${size}cm，>60cm：${base}/60×${size}`;
  }

  const startup = startupFee(colors, rules);
  const startupUnit = startup / item.quantity;
  const unit = item.quantity < rules.printing.minimum_table_quantity
    ? Math.max(tableUnit, startupUnit)
    : tableUnit;
  const ruleText = item.quantity < rules.printing.minimum_table_quantity
    ? `${sizeRule}；数量<50000，取较贵：max(${tableUnit}, ${startup}/${item.quantity})`
    : `${sizeRule}；数量≥50000，按表价`;

  return {
    unit_cny: unit,
    table_unit_cny: tableUnit,
    startup_fee_cny: startup,
    startup_unit_cny: startupUnit,
    rule_text: ruleText,
  };
}

export function fobTotal(grossWeightKg, rules) {
  if (!positive(grossWeightKg)) return null;
  const tier = rules.fob.tiers.find((row) => grossWeightKg < row.max_kg_exclusive);
  if (tier) return tier.cny;
  return grossWeightKg * rules.fob.at_or_above_25000_cny_per_kg;
}

function normalizeItem(raw, batch, rules, index) {
  const material = String(raw.material ?? "").trim().toUpperCase();
  const bagColor = normalizeBagColor(raw.bag_color);
  const colorRate = raw.color_rate_cny_per_ton ?? rules.color_masterbatch_cny_per_ton[bagColor];
  const frontColors = raw.front_colors;
  const backColors = raw.back_colors;
  const totalColors = isFiniteNumber(frontColors) && isFiniteNumber(backColors)
    ? frontColors + backColors
    : null;
  const tradeTerm = normalizeTradeTerm(pick(raw, batch, rules.defaults, "trade_term"));
  const ignorePackaging = raw.ignore_packaging ?? batch.ignore_packaging ?? false;
  return {
    ...raw,
    line_id: String(raw.line_id ?? index + 1),
    shipment_group: String(raw.shipment_group ?? "DEFAULT"),
    product_name: String(raw.product_name ?? raw.bag_type ?? `规格${index + 1}`),
    bag_type: normalizeBagType(raw.bag_type),
    material,
    width_cm: raw.width_cm,
    length_cm: raw.length_cm,
    thickness_mm: raw.thickness_mm,
    quantity: raw.quantity,
    qty_per_carton: ignorePackaging ? null : raw.qty_per_carton,
    ignore_packaging: ignorePackaging,
    front_colors: frontColors,
    back_colors: backColors,
    total_colors: totalColors,
    print_coverage_pct: raw.print_coverage_pct,
    bag_color: bagColor,
    color_rate_cny_per_ton: colorRate,
    raw_material_cny_per_ton: pick(raw, batch, rules.defaults, "raw_material_cny_per_ton"),
    additive_cny_per_ton: pick(raw, batch, rules.defaults, "additive_cny_per_ton"),
    carton_cost_cny: ignorePackaging ? 0 : pick(raw, batch, rules.defaults, "carton_cost_cny"),
    carton_tare_kg: ignorePackaging ? 0 : pick(raw, batch, rules.defaults, "carton_tare_kg"),
    markup_multiplier: pick(raw, batch, rules.defaults, "markup_multiplier"),
    tax_multiplier: pick(raw, batch, rules.defaults, "tax_multiplier"),
    fx_cny_per_usd: pick(raw, batch, rules.defaults, "fx_cny_per_usd"),
    trade_term: tradeTerm,
    price_basis: normalizePriceBasis(raw.price_basis ?? batch.price_basis, tradeTerm),
    port: String(pick(raw, batch, rules.defaults, "port") ?? "").trim(),
    plate_count: raw.plate_count,
  };
}

function validateItem(item, rules) {
  const errors = [];
  if (!["flat", "vest"].includes(item.bag_type)) errors.push("bag_type仅支持flat/vest（平口袋/背心袋）");
  if (!rules.materials[item.material]) errors.push("material仅支持HDPE/LDPE/PP");
  for (const key of ["width_cm", "length_cm", "thickness_mm"]) {
    if (!positive(item[key])) errors.push(`${key}必须为正数`);
  }
  if (!positive(item.quantity) || !integer(item.quantity)) errors.push("quantity必须为正整数");
  if (!item.ignore_packaging && (!positive(item.qty_per_carton) || !integer(item.qty_per_carton))) {
    errors.push("qty_per_carton必须为正整数，或明确设置ignore_packaging=true");
  }
  if (typeof item.ignore_packaging !== "boolean") errors.push("ignore_packaging必须为布尔值");
  if (!["TRADE_TERM", "EX_FACTORY"].includes(item.price_basis)) {
    errors.push("price_basis仅支持TRADE_TERM或EX_FACTORY");
  }
  for (const key of ["front_colors", "back_colors"]) {
    if (!nonNegative(item[key]) || !integer(item[key])) errors.push(`${key}必须为非负整数`);
  }
  if (!nonNegative(item.print_coverage_pct) || item.print_coverage_pct > 100) {
    errors.push("print_coverage_pct必须在0–100之间");
  }
  if (item.total_colors === 0 && item.print_coverage_pct !== 0) {
    errors.push("无印刷时print_coverage_pct必须为0");
  }
  if (item.total_colors > 0 && item.print_coverage_pct === 0) {
    errors.push("有印刷色数时print_coverage_pct必须大于0");
  }
  if (!isFiniteNumber(item.color_rate_cny_per_ton)) {
    errors.push("必须提供有效bag_color或color_rate_cny_per_ton");
  }
  for (const key of [
    "raw_material_cny_per_ton",
    "additive_cny_per_ton",
    "carton_cost_cny",
    "carton_tare_kg",
    "markup_multiplier",
    "tax_multiplier",
    "fx_cny_per_usd",
  ]) {
    if (!nonNegative(item[key])) errors.push(`${key}必须为非负数`);
  }
  if (item.fx_cny_per_usd === 0) errors.push("fx_cny_per_usd不能为0");
  if (item.plate_count !== undefined && item.plate_count !== null) {
    if (!nonNegative(item.plate_count) || !integer(item.plate_count)) errors.push("plate_count必须为非负整数");
    if (item.total_colors > 0 && item.plate_count === 0) errors.push("有印刷时plate_count必须为正整数或留空待确认");
    if (item.total_colors === 0 && item.plate_count !== 0) errors.push("无印刷时plate_count应为0或留空");
  }
  return errors;
}

function calculateBase(raw, batch, rules, index) {
  const item = normalizeItem(raw, batch, rules, index);
  const errors = validateItem(item, rules);
  if (errors.length) {
    return {
      ...item,
      errors,
      manual_reasons: [],
      notes: [...errors],
      status: "输入错误",
    };
  }

  const materialRule = rules.materials[item.material];
  const bagTypeWeightFactor = item.bag_type === "vest" ? 0.95 : 1;
  const unitWeightKg = item.width_cm * item.length_cm * item.thickness_mm
    * materialRule.weight_factor / 1000 * bagTypeWeightFactor;
  const theoreticalWeightKg = unitWeightKg * item.quantity;
  const cartons = item.ignore_packaging ? 0 : Math.ceil(item.quantity / item.qty_per_carton);
  const grossWeightKg = theoreticalWeightKg + cartons * item.carton_tare_kg;
  const capacity = lookupCapacity(item, rules);
  const manualReasons = [];
  if (capacity.error) manualReasons.push(capacity.error);

  const dailyKgExact = capacity.capacity_pcs === undefined
    ? null
    : capacity.capacity_pcs * unitWeightKg;
  const dailyKgRounded = dailyKgExact === null ? null : Math.round(dailyKgExact);
  const processing = dailyKgRounded === null ? null : processingFee(dailyKgRounded, rules);
  if (dailyKgRounded !== null && !processing) {
    manualReasons.push(`日产重量${dailyKgRounded}kg低于30kg，缺少加工费档`);
  }

  const rawLossRate = theoreticalWeightKg < 1000
    ? (20 + 10 * item.total_colors) / theoreticalWeightKg
    : (item.total_colors + 2) / 100;
  const lossRate = Math.max(rawLossRate, 0.06);
  const lossMultiplier = 1 + lossRate;
  const printing = printingPrice(item, rules);
  if (printing.manual) manualReasons.push(printing.reason);

  const materialCostPerPc = processing
    ? (
      item.raw_material_cny_per_ton
      + processing.cny_per_ton
      + item.color_rate_cny_per_ton
      + item.additive_cny_per_ton
    ) / 1000 * lossMultiplier * unitWeightKg
    : null;
  const cartonCostPerPc = item.ignore_packaging ? 0 : item.carton_cost_cny / item.qty_per_carton;
  const costBeforeFreight = materialCostPerPc === null || printing.unit_cny === undefined
    ? null
    : materialCostPerPc + printing.unit_cny + cartonCostPerPc;

  const plateFeeBase = item.width_cm * item.length_cm * 0.18;
  const plateFeePerPlate = Math.max(plateFeeBase, 400);
  const platePending = item.total_colors > 0 && (item.plate_count === undefined || item.plate_count === null);
  const plateFeeTotal = item.total_colors === 0
    ? 0
    : platePending
      ? null
      : plateFeePerPlate * item.plate_count;

  return {
    ...item,
    material_factor: materialRule.weight_factor,
    bag_type_weight_factor: bagTypeWeightFactor,
    unit_weight_kg: unitWeightKg,
    theoretical_weight_kg: theoreticalWeightKg,
    carton_count: cartons,
    net_kg_per_carton: item.ignore_packaging ? null : unitWeightKg * item.qty_per_carton,
    gross_kg_per_carton: item.ignore_packaging ? null : unitWeightKg * item.qty_per_carton + item.carton_tare_kg,
    gross_weight_kg: grossWeightKg,
    capacity,
    daily_kg_exact: dailyKgExact,
    daily_kg_rounded: dailyKgRounded,
    processing,
    raw_loss_rate: rawLossRate,
    loss_rate: lossRate,
    loss_multiplier: lossMultiplier,
    printing,
    material_cost_per_pc: materialCostPerPc,
    carton_cost_per_pc: cartonCostPerPc,
    cost_before_freight_per_pc: costBeforeFreight,
    plate_fee_base_cny: plateFeeBase,
    plate_fee_per_plate_cny: plateFeePerPlate,
    plate_fee_total_cny: plateFeeTotal,
    plate_count_pending: platePending,
    fob_total_cny: null,
    fob_allocated_cny: null,
    freight_cny_per_pc: null,
    total_cost_cny_per_pc: null,
    selling_cny_per_pc: null,
    selling_usd_per_pc: null,
    selling_cny_tax_included_per_pc: null,
    errors,
    manual_reasons: manualReasons,
    notes: [
      ...manualReasons,
      ...(item.ignore_packaging ? ["按用户要求忽略包装成本与包装重量"] : []),
    ],
  };
}

function finalizeItem(item) {
  const result = { ...item, notes: [...item.notes] };
  const isExFactory = result.price_basis === "EX_FACTORY";
  if (result.cost_before_freight_per_pc !== null && (result.freight_cny_per_pc !== null || isExFactory)) {
    result.total_cost_cny_per_pc = result.cost_before_freight_per_pc + (isExFactory ? 0 : result.freight_cny_per_pc);
    result.selling_cny_per_pc = result.total_cost_cny_per_pc * result.markup_multiplier;
    result.selling_usd_per_pc = result.selling_cny_per_pc / result.fx_cny_per_usd;
    result.selling_cny_tax_included_per_pc = result.selling_cny_per_pc * result.tax_multiplier;
  }

  if (result.errors.length) {
    result.status = "输入错误";
  } else if (result.manual_reasons.length) {
    result.status = "需人工核价";
  } else if (isExFactory) {
    result.notes.push("出厂价不含运费");
    if (result.plate_count_pending) {
      result.status = "可报价（出厂价）；铜版块数待确认";
      result.notes.push("铜版单块费用已算，块数待人工确认");
    } else {
      result.status = "可报价（出厂价）";
    }
  } else if (result.freight_cny_per_pc === null) {
    result.status = "运费待填";
    if (!result.notes.includes("运费待填")) result.notes.push("运费待填");
  } else if (result.plate_count_pending) {
    result.status = "可报价；铜版块数待确认";
    result.notes.push("铜版单块费用已算，块数待人工确认");
  } else {
    result.status = "可报价";
  }
  return result;
}

export function calculateBatch(input, rules) {
  if (!input || !Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("input.items必须是非空数组");
  }
  const batch = { ...(input.batch ?? {}) };
  const baseItems = input.items.map((raw, index) => calculateBase(raw, batch, rules, index));

  const seen = new Set();
  for (const item of baseItems) {
    if (seen.has(item.line_id)) {
      item.errors.push(`line_id重复：${item.line_id}`);
      item.notes.push(`line_id重复：${item.line_id}`);
    }
    seen.add(item.line_id);
  }

  const groups = new Map();
  for (const item of baseItems) {
    if (!groups.has(item.shipment_group)) groups.set(item.shipment_group, []);
    groups.get(item.shipment_group).push(item);
  }

  for (const [groupId, groupItems] of groups) {
    const exFactoryItems = groupItems.filter((item) => item.price_basis === "EX_FACTORY");
    for (const item of exFactoryItems) item.notes.push("按出厂价计价，不参与FOB运费分摊");
    const freightItems = groupItems.filter((item) => item.price_basis !== "EX_FACTORY");
    if (!freightItems.length) continue;
    const terms = new Set(freightItems.map((item) => item.trade_term));
    const ports = new Set(freightItems.map((item) => normalizePort(item.port)));
    if (terms.size !== 1 || ports.size !== 1) {
      for (const item of freightItems) {
        item.notes.push(`运输组${groupId}存在不同贸易条款或港口，运费待人工确认`);
      }
      continue;
    }
    const tradeTerm = freightItems[0].trade_term;
    const port = normalizePort(freightItems[0].port);
    if (tradeTerm !== "FOB") {
      for (const item of freightItems) item.notes.push(`${tradeTerm || "未填写条款"}运费留空`);
      continue;
    }
    if (!rules.fob.supported_ports.includes(port)) {
      for (const item of freightItems) item.notes.push(`FOB港口${freightItems[0].port}不在深圳/广州规则内`);
      continue;
    }
    const eligible = freightItems.filter((item) => positive(item.gross_weight_kg));
    if (!eligible.length) continue;
    const groupGross = eligible.reduce((sum, item) => sum + item.gross_weight_kg, 0);
    const totalFob = fobTotal(groupGross, rules);
    for (const item of eligible) {
      const allocated = totalFob * item.gross_weight_kg / groupGross;
      item.shipment_group_gross_weight_kg = groupGross;
      item.fob_total_cny = totalFob;
      item.fob_allocated_cny = allocated;
      item.freight_cny_per_pc = allocated / item.quantity;
    }
  }

  return {
    metadata: {
      quote_id: String(batch.quote_id ?? ""),
      customer: String(batch.customer ?? ""),
      rules_version: rules.version,
      generated_at: new Date().toISOString(),
    },
    items: baseItems.map(finalizeItem),
  };
}

function parseCliArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`无效参数：${key ?? ""}`);
    args[key.slice(2)] = value;
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.input) throw new Error("必须提供--input");
  const input = JSON.parse(await fs.readFile(path.resolve(args.input), "utf8"));
  const rules = await loadRules(args.rules ? path.resolve(args.rules) : undefined);
  const result = calculateBatch(input, rules);
  const output = JSON.stringify(result, null, 2);
  if (args.output) {
    await fs.writeFile(path.resolve(args.output), `${output}\n`, "utf8");
  } else {
    process.stdout.write(`${output}\n`);
  }
}
