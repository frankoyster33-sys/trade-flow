import {calculateBatch,loadRules} from '../vendor/batch/scripts/quote_engine.mjs';
export const mainInputs={A3:'width_cm',B3:'length_cm',C3:'thickness_mm',F3:'quantity',E5:'qty_per_carton',B4:'carton_cost_cny',D4:'carton_tare_kg',B7:'raw_material_cny_per_ton',B9:'color_rate_cny_per_ton',B10:'additive_cny_per_ton',B18:'markup_multiplier'};
export const infoInputs={C:'product_name',D:'bag_type',E:'material',F:'front_colors',G:'back_colors',H:'print_coverage_pct',I:'bag_color',J:'plate_count',K:'shipment_group',L:'fx_cny_per_usd',M:'tax_multiplier',N:'ignore_packaging'};
export function cleanInput(raw,id){
 const keys=[...Object.values(mainInputs),...Object.values(infoInputs),'line_id','trade_term','price_basis','port','customer_model'];
 const batchKeys=['trade_term','port','price_basis','raw_material_cny_per_ton','carton_cost_cny','carton_tare_kg','markup_multiplier','tax_multiplier','fx_cny_per_usd','additive_cny_per_ton'];
 const batch=Object.fromEntries(batchKeys.filter(k=>raw.batch?.[k]!==null&&raw.batch?.[k]!==undefined&&raw.batch[k]!=='').map(k=>[k,raw.batch[k]]));
 const customer=Object.fromEntries(['company','contact','email','phone','address'].map(k=>[k,String(raw.customer?.[k]||'').slice(0,1000)]));
 batch.quote_id=id;batch.customer=customer.company;
 if(batch.trade_term==='EXW')batch.price_basis='EX_FACTORY';
 const together=(raw.evidence||[]).some(e=>e.field==='shipment_group'&&/(一起出货|同批出货|同一.*订单|single shipment|ship.*together|combined shipment)/i.test(e.text||''));
 const items=raw.items.map((item,i)=>{
  const row={...Object.fromEntries(keys.filter(k=>item[k]!==undefined&&item[k]!==null).map(k=>[k,item[k]])),line_id:String(i+1),shipment_group:together?String(item.shipment_group||i+1):String(i+1),ignore_packaging:item.ignore_packaging===true};
  const noPrint=(raw.evidence||[]).some(e=>String(e.line_id)===String(item.line_id??i+1)&&['printing','front_colors','back_colors','print_coverage_pct'].includes(e.field)&&/^(none|no printing|unprinted|无印刷|不印刷)$/i.test(String(e.text||'').trim()));
  if(noPrint&&![row.front_colors,row.back_colors,row.print_coverage_pct].some(n=>typeof n==='number'&&n>0)){row.front_colors=0;row.back_colors=0;row.print_coverage_pct=0;row.plate_count=0;}
  if(!row.product_name)row.product_name=({flat:'平口袋',vest:'背心袋'}[row.bag_type]||row.bag_type||'待确认袋型');
  return row;
 });
 return {batch,customer,items,uncertainties:(Array.isArray(raw.uncertainties)?raw.uncertainties:[]).map(String).filter(x=>x!=='待确认的具体信息'),evidence:(Array.isArray(raw.evidence)?raw.evidence:[]).slice(0,1000)};
}
export async function validateInput(input){
 const rules=await loadRules(),result=calculateBatch(input,rules);
 const labels={bag_type:'袋型',material:'材质',width_cm:'宽度(cm)',length_cm:'长度(cm)',thickness_mm:'厚度(mm)',quantity:'数量',qty_per_carton:'每箱数量',ignore_packaging:'是否忽略包装',front_colors:'正面印刷色数',back_colors:'背面印刷色数',print_coverage_pct:'印刷覆盖率(%)',bag_color:'袋子颜色',color_rate_cny_per_ton:'色母费用',plate_count:'铜版块数',fx_cny_per_usd:'美元汇率'};
 return {result,errors:result.items.flatMap((x,i)=>x.errors.map(e=>`第${i+1}行：${e.replace(/\b[a-z_]+\b/g,k=>labels[k]||k)}`))};
}
