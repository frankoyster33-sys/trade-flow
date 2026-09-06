import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {PYTHON,ROOT} from './config.mjs';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';
import {buildBase} from '../vendor/batch/scripts/build_quotes.mjs';
import {calculateBatch,loadRules} from '../vendor/batch/scripts/quote_engine.mjs';
import {mainInputs,infoInputs,validateInput} from './input.mjs';
const literal=v=>typeof v==='string'&&v.startsWith('=')?"'"+v:v??null;
const set=(s,a,v)=>{s.getRange(a).clear({applyTo:'contents'});s.getRange(a).values=[[literal(v)]];};
const value=(s,a)=>s.getRange(a).values[0]?.[0]??null;
const formula=(s,a)=>s.getRange(a).formulas[0]?.[0]||null;
const cell=(s,a)=>({v:value(s,a),f:formula(s,a)});
const token=c=>c?.f?['f',c.f.replace(/'([^']+)'!/g,'$1!')]:['v',c?.v===''?null:c?.v??null];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const priceCell=(meta)=>meta.price_type==='TAX_INCLUDED'?'B20':meta.currency==='CNY'?'B19':'C19';
export async function inspectWorkbook(file){
 const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(file));
 await wb.inspect({kind:'sheet',include:'id,name',maxChars:1000});
 const {stdout}=await promisify(execFile)(PYTHON,[path.join(ROOT,'lib/read_saved.py'),file],{maxBuffer:5*1024*1024});
 // Some WPS empty shared strings are imported as their numeric string-table
 // index. Restore literal cells from an independent, read-only parser first.
 for(const [name,cells]of Object.entries(JSON.parse(stdout))){const s=wb.worksheets.getItem(name);for(const [a,v]of cells)if(value(s,a)!==v)set(s,a,v);}
 // WPS legally removes quotes around Chinese sheet names. Normalize only the
 // in-memory copy so the calculation library reads those references correctly.
 const names=wb.worksheets.items.map(s=>s.name).sort((a,b)=>b.length-a.length);
 for(const s of wb.worksheets.items){const formulas=s.getRange('A1:U100').formulas;for(let r=0;r<formulas.length;r++)for(let c=0;c<formulas[r].length;c++){const original=formulas[r][c];if(!original)continue;let f=original;for(const name of names)f=f.replaceAll(name+'!',"'"+name+"'!");if(f!==original)s.getCell(r,c).formulas=[[f]];}}
 return wb;
}
export function capture(wb,names){
 const out={};
 for(const name of [...names,'报价资料','批量汇总']){
   const s=wb.worksheets.getItem(name),address=name==='报价资料'?`A1:N${16+names.length}`:name==='批量汇总'?`A1:U${4+names.length}`:'A1:G23';
   out[name]={values:s.getRange(address).values,formulas:s.getRange(address).formulas};
 }
 return out;
}
function oldCell(snapshot,sheet,address){
 const [,letters,num]=address.match(/^([A-Z]+)(\d+)$/);let col=0;for(const c of letters)col=col*26+c.charCodeAt(0)-64;
 return {v:snapshot[sheet]?.values[Number(num)-1]?.[col-1]??null,f:snapshot[sheet]?.formulas[Number(num)-1]?.[col-1]||null};
}
function changed(wb,base,name,address){
 const a=cell(wb.worksheets.getItem(name),address),b=oldCell(base,name,address);
 if(!a.f&&!b.f&&typeof a.v==='number'&&typeof b.v==='number')return Math.abs(a.v-b.v)>1e-12*Math.max(1,Math.abs(a.v),Math.abs(b.v));
 return !same(token(a),token(b));
}
async function scan(wb){const r=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:20},maxChars:2000});if(r.ndjson.includes('"kind":"match"'))throw new Error('Excel 存在公式错误，请先修正后再生成。');}
export async function buildInternal(input,file,{overrides={},commercial=null,previewDir=null}={}){
 const checked=await validateInput(input);if(checked.errors.length)throw new Error(checked.errors.join('；'));
 const {workbook:wb,results,quoteSheetNames:names}=await buildBase(input);
 const info=wb.worksheets.add('报价资料');info.showGridLines=false;
 const meta=commercial||{...input.customer,price_type:input.batch.price_basis==='EX_FACTORY'?'EXW':(input.batch.trade_term||'FOB'),currency:'USD',location:input.batch.port||'Shenzhen'};
 const rows=[['报价资料','AI 已填写可识别信息；仅补充缺项。尺寸、数量、成本和单价在原报价页修改。'],['报价编号',input.batch.quote_id],['客户公司',meta.company],['客户联系人',meta.contact],['客户邮箱',meta.email],['客户电话',meta.phone],['客户地址',meta.address],['对外报价类型（FOB / EXW / TAX_INCLUDED）',meta.price_type],['对外币种（USD / CNY）',meta.currency],['港口／出厂地点',meta.location],['审核与生成','保存并关闭 Excel 后，回到系统点击生成。尺寸等核算输入有变化时，会另存重算版本供确认。'],['识别待确认',(input.uncertainties||[]).join('；')||'无'],['参数来源','未明确指定的原料价、汇率、包装、加价系数使用已确认的批量报价规则；请审核是否适用。'],['修改说明','蓝字是输入；批量汇总价格可改。修改成本时请在报价页修改，勿删除／改名报价页。']];
 info.getRange('A1:B14').values=rows.map(r=>r.map(literal));
 info.getRange('A16:N16').values=[['序号','报价页','产品名称','袋型 flat/vest','材料','正面色数','背面色数','印刷覆盖率%','颜色','铜版块数','出货组','CNY/USD','含税倍数','忽略包装']];
 results.items.forEach((item,i)=>{const r=17+i;info.getRange(`A${r}:N${r}`).values=[[item.line_id,names[i],...Object.values(infoInputs).map(k=>literal(item[k]))]];});
 info.getRange(`A1:N${16+names.length}`).format={font:{name:'Microsoft YaHei',size:10},verticalAlignment:'center',wrapText:true};
 info.getRange('A:A').format.columnWidth=34;info.getRange('B:B').format.columnWidth=80;info.getRange('C:N').format.columnWidth=18;
 info.getRange('1:14').format.rowHeight=30;info.getRange('11:14').format.rowHeight=46;
 info.getRange('A1:B1').format.fill='#E9F1E4';info.getRange('A16:N16').format.fill='#E9F1E4';
 info.getRange('B3:B10').format.font.color='#0000FF';info.getRange(`C17:N${16+names.length}`).format.font.color='#0000FF';
 info.getRange('B8').dataValidation={rule:{type:'list',values:['FOB','EXW','TAX_INCLUDED']}};
 info.getRange('B9').dataValidation={rule:{type:'list',values:['USD','CNY']}};
 info.freezePanes.freezeRows(16);
 const summary=wb.worksheets.getItem('批量汇总');
 for(let i=0;i<names.length;i++){
  const s=wb.worksheets.getItem(names[i]);
  set(s,'E2','单重（kg）');set(s,'A18','加价倍数：');
  for(let row=8;row<=20;row++)s.getRange(`E${row}:G${row}`).merge();
  s.getRange('11:12').format.rowHeight=42;
  set(s,'E12',`原始 ${((results.items[i].raw_loss_rate||0)*100).toFixed(4)}%；采用 ${((results.items[i].loss_rate||0)*100).toFixed(4)}%`);
  for(const a of Object.keys(mainInputs))s.getRange(a).format.font.color='#0000FF';
  if(!input.items[i].ignore_packaging){s.getRange('F5').formulas=[['=ROUNDUP(F3/E5,0)']];s.getRange('F6').formulas=[['=E6+D4']];s.getRange('G6').formulas=[['=G3+F5*D4']];s.getRange('B15').formulas=[['=B4/E5']];}
  const r=17+i;s.getRange('C19').formulas=[[`=IF(ISNUMBER(B19),B19/'报价资料'!L${r},"")`]];s.getRange('B20').formulas=[[`=IF(ISNUMBER(B19),B19*'报价资料'!M${r},"")`]];
  for(const [a,v] of Object.entries(overrides[names[i]]||{}))set(s,a,v);
  for(const [column,address] of Object.entries({G:'F3',H:'E4',L:'B14',M:'G6',N:'B16',O:'B17',P:'B19',Q:'C19',R:'B20',S:'B21'}))summary.getRange(`${column}${5+i}`).formulas=[[`='${names[i]}'!${address}`]];
 }
 set(summary,'A3','尺寸和成本在报价页修改；单价可在本汇总或对应报价页修改。数量档独立核算，按出货组生成对外报价单。');
 const evidence=wb.worksheets.add('识别来源');evidence.showGridLines=false;
 const erows=[['规格','字段','来源位置','原文'],...(input.evidence||[]).map(e=>[e.line_id,e.field,e.source,e.text].map(literal))];
 if(erows.length===1)erows.push(['','说明','人工／系统导入','未提供逐字段识别来源']);
 evidence.getRange(`A1:D${erows.length}`).values=erows;evidence.getRange('A:D').format.columnWidth=30;evidence.getRange('D:D').format.columnWidth=65;evidence.getRange(`A1:D${erows.length}`).format.wrapText=true;evidence.getRange('A1:D1').format.fill='#E9F1E4';
 await scan(wb);
 await fs.mkdir(path.dirname(file),{recursive:true});await(await SpreadsheetFile.exportXlsx(wb)).save(file);
 if(previewDir){await fs.mkdir(previewDir,{recursive:true});for(const [name,range]of [...names.map(n=>[n,'A1:G23']),['报价资料','A1:B14'],['批量汇总',`A1:U${4+names.length}`],['识别来源',`A1:D${Math.min(erows.length,24)}`]]){const img=await wb.render({sheetName:name,range,scale:1,format:'png'});await fs.writeFile(path.join(previewDir,name+'.png'),new Uint8Array(await img.arrayBuffer()));}}
 return {names,result:results,baseline:capture(wb,names),commercial:meta};
}
export async function readReviewed(file,record){
 const wb=await inspectWorkbook(file),base=record.baseline,names=record.names;
 for(const name of [...names,'报价资料','批量汇总']){try{wb.worksheets.getItem(name);}catch{throw new Error(`缺少“${name}”工作表，请恢复原表名称。`);}}
 const info=wb.worksheets.getItem('报价资料');
 if(String(value(info,'B2'))!==record.id||names.some(name=>String(value(wb.worksheets.getItem(name),'B23'))!==record.id))throw new Error('Excel 的报价编号与当前记录不同，请打开这一行对应的原报价文件。');
 const input=structuredClone(record.input),overrides=structuredClone(record.overrides||{}),changes=[];
 const meta={...record.commercial};
 for(const [key,a] of Object.entries({company:'B3',contact:'B4',email:'B5',phone:'B6',address:'B7',price_type:'B8',currency:'B9',location:'B10'}))meta[key]=String(value(info,a)||'').trim();
 const inputBasis=meta.price_type==='EXW'?'EX_FACTORY':'TRADE_TERM';
 if(meta.price_type!==record.commercial.price_type||meta.location!==record.commercial.location){input.batch.trade_term=meta.price_type==='TAX_INCLUDED'?'FOB':meta.price_type;input.batch.price_basis=inputBasis;input.batch.port=meta.location;changes.push('贸易条款或地点');}
 input.customer={company:meta.company,contact:meta.contact,email:meta.email,phone:meta.phone,address:meta.address};input.batch.customer=meta.company;
 for(let i=0;i<names.length;i++){
  const name=names[i],s=wb.worksheets.getItem(name),item=input.items[i],r=i+17;
  for(const [a,k] of Object.entries(mainInputs))if(changed(wb,base,name,a)){item[k]=value(s,a);changes.push(`${name} ${a}`);}
  for(const [c,k] of Object.entries(infoInputs))if(changed(wb,base,'报价资料',c+r)){item[k]=value(info,c+r);changes.push(`报价资料 ${c+r}`);if(k==='bag_color')delete item.color_rate_cny_per_ton;}
  if(changed(wb,base,name,'D3'))throw new Error(`${name} 材料系数 D3 不能单独修改，请在“报价资料”修改材料，系统会重算重量。`);
  // Retain explicit human prices and exceptional manually quoted costs when recalculating.
  for(const a of ['B8','B11','B13','B14','B15','B16','B19','C19','B20','B21','F6']){
   if(changed(wb,base,name,a)){
    const c=cell(s,a);if(c.f)throw new Error(`${name} ${a} 的公式已修改。请保留原公式，或填入确认后的数字。`);
    if(typeof c.v!=='number'||!Number.isFinite(c.v)||c.v<0)throw new Error(`${name} ${a} 请填写有效数字。`);
    (overrides[name]??={})[a]=c.v;
   }
  }
  const sum=wb.worksheets.getItem('批量汇总');
  for(const [c,a] of Object.entries({P:'B19',Q:'C19',R:'B20'}))if(changed(wb,base,'批量汇总',c+(i+5))){
    const v=value(sum,c+(i+5));if(!positive(v))throw new Error(`批量汇总 ${c+(i+5)} 请填写确认后的正数单价。`);
    if(changed(wb,base,name,a)&&Math.abs(value(s,a)-v)>1e-10)throw new Error(`批量汇总与 ${name} 的单价不一致，请统一后保存。`);
    (overrides[name]??={})[a]=v;set(s,a,v);
  }
  for(const c of ['D','E','F','G','H','I','J','K','L','M','N','O','S'])if(changed(wb,base,'批量汇总',c+(i+5)))throw new Error(`批量汇总 ${c+(i+5)} 已改动。请在对应报价页修改该数据，再恢复汇总原单元格。`);
 }
 const validated=await validateInput(input);if(validated.errors.length)throw new Error(validated.errors.join('；'));
 if(changes.length)return {recalculate:true,input,overrides,commercial:meta,changes};
 await scan(wb);
 const missing=[];for(const [k,label]of Object.entries({company:'客户公司',contact:'客户联系人',location:'港口／出厂地点'}))if(!meta[k])missing.push(label);
 if(!meta.email&&!meta.phone)missing.push('客户邮箱或电话');
 if(!['USD','CNY'].includes(meta.currency))missing.push('支持的币种 USD 或 CNY');
 if(!['FOB','EXW','TAX_INCLUDED'].includes(meta.price_type))missing.push('对外报价类型 FOB / EXW / TAX_INCLUDED');
 if(meta.price_type==='TAX_INCLUDED'&&meta.currency!=='CNY')missing.push('含税价币种需为 CNY');
 if(missing.length)throw new Error('请在 Excel 的“报价资料”补齐：'+missing.join('、')+'。');
 const items=validated.result.items.map((item,i)=>{
  const s=wb.worksheets.getItem(names[i]);const unitPrice=value(s,priceCell(meta));
  if(!positive(unitPrice))throw new Error(`${names[i]} 请填写确认后的对外单价（${priceCell(meta)}）。`);
  if(item.plate_count_pending)throw new Error(`${names[i]} 铜版块数待确认，请在“报价资料”补齐。`);
  if(!positive(value(s,'E5'))||!positive(value(s,'F6')))throw new Error(`${names[i]} 请补齐每箱数量、毛重。`);
  if(item.manual_reasons.length&&!overrides[names[i]]?.[priceCell(meta)]&&!changed(wb,base,names[i],priceCell(meta)))throw new Error(`${names[i]} 需要人工核价：${item.manual_reasons.join('；')}。请填入确认后的单价。`);
  return {...item,approved_unit_price:Number(unitPrice.toFixed(6)),gross_kg_per_carton:value(s,'F6'),qty_per_carton:value(s,'E5'),plate_fee_total_cny:value(s,'B21')};
 });
 return {recalculate:false,input,items,commercial:meta,overrides};
}
