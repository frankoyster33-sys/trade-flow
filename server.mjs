import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {ROOT,DATA,INTERNAL,EXTERNAL,PYTHON,PORT,atomicJSON,readJSON,getSettings,publicSettings,day,safeName} from './lib/config.mjs';
import {listModels,pickModels,extract} from './lib/provider.mjs';
import {cleanInput,validateInput} from './lib/input.mjs';
import {hash,within,listFiles,publish} from './lib/files.mjs';
const DBFILE=path.join(DATA,'records.json');
await fs.mkdir(DATA,{recursive:true,mode:0o700});
let db=await readJSON(DBFILE,{records:[]});
for(const r of db.records)if(r.busy){r.busy=false;r.error='上次处理被中断，可重试。';}
await atomicJSON(DBFILE,db);
const csrf=crypto.randomBytes(32).toString('hex');
const ORIGIN=`http://127.0.0.1:${PORT}`;
const jobs=new Map();let queue=Promise.resolve();
function run(file,args,{timeout=300000}={}){return new Promise((resolve,reject)=>{const p=spawn(file,args,{cwd:ROOT,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});let out='',err='';p.stdout.on('data',b=>{if(out.length<200000)out+=b;});p.stderr.on('data',b=>{if(err.length<10000)err+=b;});const timer=setTimeout(()=>p.kill('SIGTERM'),timeout);p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('close',code=>{clearTimeout(timer);if(code===0)resolve(out);else reject(new Error(err.trim().slice(-2000)||'处理超时或文件无法读取。'));});});}
const save=()=>atomicJSON(DBFILE,db);
const getRecord=id=>{const r=db.records.find(x=>x.id===id);if(!r)throw new Error('未找到此报价。');return r;};
async function doWorker(request){const dir=path.join(DATA,'jobs',crypto.randomUUID());await fs.mkdir(dir,{recursive:true});const requestFile=path.join(dir,'request.json'),resultFile=path.join(dir,'result.json');await atomicJSON(requestFile,{...request,resultFile});await run(process.execPath,[path.join(ROOT,'lib/worker.mjs'),requestFile],{timeout:600000});return readJSON(resultFile,null);}
function enqueue(record,label,task){
 if(record.busy)throw new Error('这份报价正在处理，请稍候。');
 const id=crypto.randomUUID(),job={id,recordId:record.id,label,status:'queued'};jobs.set(id,job);record.busy=true;record.error='';
 queue=queue.then(async()=>{job.status='running';record.progress=label;await save();try{await task();job.status='done';}catch(e){job.status='error';job.error=e.message;record.error=e.message;}finally{record.busy=false;record.progress='';await save();}});
 return {jobId:id,recordId:record.id};
}
async function internalBuild(record,input,options={}){
 const version=(record.internalVersion||0)+1;const dir=path.join(DATA,record.id,'build-'+version);await fs.mkdir(dir,{recursive:true});
 const staged=path.join(dir,'internal.xlsx');
 const result=await doWorker({kind:'internal',input,file:staged,options:{...options,previewDir:path.join(dir,'previews')}});
 const name=`${day()}/${record.id}_${safeName(input.customer.company)}_内部报价_v${version}.xlsx`;
 const file=await publish(INTERNAL,name,staged);
 record.history??=[];if(record.path)record.history.push({path:record.path,version:record.internalVersion});
 Object.assign(record,{input,path:file,internalVersion:version,names:result.names,baseline:result.baseline,commercial:result.commercial,engine:result.result,baselineHash:await hash(file),status:'review',missing:[],overrides:options.overrides||{},customer:input.customer.company||'未填写客户',product:input.items.map(x=>String(x.product_name||'').includes(x.material)?x.product_name:`${x.material||''} ${x.product_name||''}`).join(' / '),spec:input.items.map(x=>`${x.width_cm}×${x.length_cm}cm ${x.thickness_mm}mm · ${x.quantity}pcs`).join('；')});
}
async function recognize(record,text,images=[],previous=null){
 const settings=await getSettings();record.progress='正在识别询价资料';await save();
 const raw=await extract(settings,{text,images,previous});record.extracted=raw;
 const input=cleanInput(raw,record.id),check=await validateInput(input);record.input=input;record.customer=input.customer.company||'未填写客户';record.product=input.items.map(x=>x.product_name||x.material||'规格').join(' / ');
 if(check.errors.length){record.status='missing';record.missing=check.errors;return;}
 record.progress='正在生成内部 Excel';await save();await internalBuild(record,input);
}
async function generate(record){
 if(!record.path||!record.baseline)throw new Error('这份文件尚未建立报价资料。请从概览导入原询价生成内部表。');
 const source=await within(INTERNAL,record.path);const digest=await hash(source);
 const snapdir=path.join(DATA,record.id,'snapshots',crypto.randomUUID());await fs.mkdir(snapdir,{recursive:true});const snap=path.join(snapdir,'reviewed.xlsx');await fs.copyFile(source,snap);
 if(await hash(snap)!==digest||await hash(source)!==digest)throw new Error('Excel 正在保存，请保存完成后再生成。');
 const review=await doWorker({kind:'review',file:snap,record});
 if(await hash(source)!==digest)throw new Error('读取期间 Excel 已变更，请保存完成后重新生成。');
 if(review.recalculate){record.progress='输入已修改，重新核算';await save();await internalBuild(record,review.input,{overrides:review.overrides,commercial:review.commercial});record.notice='尺寸、数量或核算参数已变更，已另存重算版本。请审核新 Excel，再点生成。';return;}
 const version=(record.outputVersion||0)+1,groups=Map.groupBy(review.items,x=>x.shipment_group);const pending=[];
 for(const [group,items]of groups){
   const suffix=groups.size>1?'_组'+safeName(group):'';const quoteNo=record.id.replace(/^Q-/,'QS-')+suffix+'-V'+version;const date=day();const valid=day(Date.now()+30*86400000);
   const m=review.commercial;const loc=m.price_type==='EXW'?m.location:m.location;
   const payload={quote:{quote_no:quoteNo,date,valid_until:valid,currency:m.currency,price_type:m.price_type,price_basis:m.price_type==='TAX_INCLUDED'?`Tax included — ${loc}`:`${m.price_type} ${loc}, China — Incoterms® 2020`,unit:'PCS',price_precision:6,pricing_note:groups.size>1?'This quotation is an independent quantity/shipment option. Other options are quoted separately.':'Prices apply to the quantities and specifications shown above.',payment:'To be mutually agreed',production_lead_time:'To be confirmed after sample and specification approval',validity:'30 days from quote date',freight_duties:m.price_type==='FOB'?'Ocean freight, insurance and import duties excluded':'Excluded unless expressly stated'},customer:{company:m.company,contact:m.contact,email:m.email,phone:m.phone,address:m.address},seller:{name:'Frank Yuan',title:'Sales Representative',company:'Dongguan Hengsheng Polybag Co., Ltd.',email:'sales2@hjpoly.com',website:'www.dgsphs.com',address:'No. 8 Tangzhou Road, Shipai Town, Dongguan, Guangdong 523336, China'},sample:{requested:false,cost:150,currency:'USD',basis:'size',time:'10–15 days'},items:items.map(x=>({customer_model:x.customer_model||'',product:`${x.material} ${x.bag_type==='flat'?'Flat Bags':'Vest Bags'}`,size:`${x.width_cm} × ${x.length_cm} cm`,thickness:`${x.thickness_mm} mm`,remark:`Bag color: ${{transparent:'Clear',black:'Black',white:'White',other:'Other color'}[x.bag_color]||x.bag_color}`,printing:x.total_colors===0?'No printing':`Front: ${x.front_colors} color(s); back: ${x.back_colors} color(s); coverage ${x.print_coverage_pct}%`,quantity:x.quantity,unit_price:x.approved_unit_price,qty_per_carton:x.qty_per_carton,gross_weight_kg:x.gross_kg_per_carton,carton_calculation:{bag_width_cm:x.width_cm,bag_length_cm:x.length_cm,thickness_mm:x.thickness_mm},copper_plate_fee:{amount:x.plate_fee_total_cny||0,currency:'CNY',remark:'One-time charge; excluded from bag unit price'}}))};
   const file=path.join(snapdir,quoteNo+'.xlsx'),preview=path.join(snapdir,quoteNo+'.png'),input=path.join(snapdir,quoteNo+'.json');await atomicJSON(input,payload);
   await run(process.execPath,[path.join(ROOT,'vendor/commercial/build_quotation.mjs'),'--input',input,'--output',file,'--preview',preview,'--logo',path.join(ROOT,'vendor/commercial/hengsheng-logo.png')],{timeout:600000});
   pending.push({file,preview,quoteNo,payload,group});
 }
 if(await hash(source)!==digest)throw new Error('生成期间 Excel 已被修改。此次文件未发布，请重新点击生成。');
 const published=[];
 try{for(const p of pending){const file=await publish(EXTERNAL,`${day()}/${p.quoteNo}_${safeName(review.commercial.company)}_Quotation.xlsx`,p.file);published.push(file);}}
 catch(e){for(const file of published)await fs.unlink(file);throw e;}
 record.outputs??=[];for(let i=0;i<pending.length;i++){const p=pending[i];record.outputs.push({id:crypto.randomUUID(),path:published[i],preview:p.preview,quoteNo:p.quoteNo,date:new Date().toISOString(),version,sourceHash:digest,sourcePath:source,sourceSnapshot:snap,group:p.group,items:p.payload.items.map(x=>({quantity:x.quantity,unitPrice:x.unit_price})),currency:review.commercial.currency});}
 record.outputVersion=version;record.status='done';record.notice=`已生成 ${pending.length} 份对外报价单，来自刚才保存的内部 Excel。`;record.lastGeneratedHash=digest;record.commercial=review.commercial;record.customer=review.commercial.company;record.overrides=review.overrides;
}
async function pool(){
 const [ins,outs]=await Promise.all([listFiles(INTERNAL),listFiles(EXTERNAL)]);const known=new Set(db.records.flatMap(r=>[r.path,...(r.history||[]).map(x=>x.path)]).filter(Boolean));
 const rows=[];
 for(const r of db.records){const file=ins.find(f=>f.path===r.path);const modified=file?.modified||r.created;const currentHash=file?await hash(file.path):null;rows.push({id:r.id,customer:r.customer||'未填写客户',product:r.product||'询价',spec:r.spec||'',date:day(r.created),modified,fileName:file?.name,status:r.busy?'generating':r.status==='missing'?'missing':!file?'error':r.lastGeneratedHash===currentHash?'done':currentHash!==r.baselineHash?'edited':'review',error:r.error,notice:r.notice,progress:r.progress,missing:r.missing||[],hasFile:!!file,internalVersion:r.internalVersion||0,sourceCount:r.sources?.length||0,outputs:(r.outputs||[]).filter(o=>outs.some(x=>x.path===o.path)).map(({sourceSnapshot,sourcePath,sourceHash,path:op,preview,...o})=>({...o,fileName:path.basename(op)}))});}
 for(const f of ins.filter(f=>!known.has(f.path)))rows.push({id:'file-'+crypto.createHash('sha256').update(f.path).digest('hex').slice(0,16),customer:f.name,product:'文件夹中的 Excel',spec:'',date:f.modified.slice(0,10),modified:f.modified,fileName:f.name,status:'unlinked',hasFile:true,outputs:[]});
 const knownOut=new Set(db.records.flatMap(r=>(r.outputs||[]).map(o=>o.path)));
 return {records:rows.sort((a,b)=>b.modified.localeCompare(a.modified)),externalFiles:outs.filter(f=>!knownOut.has(f.path)).map(f=>({id:'out-'+crypto.createHash('sha256').update(f.path).digest('hex').slice(0,16),fileName:f.name,date:f.modified})),settings:publicSettings(await getSettings())};
}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
async function body(req){let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>35*1024*1024)throw new Error('本次资料超过25MB，请分批导入。');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
async function resolveFile(id,kind){
 if(id.startsWith('file-')){const f=(await listFiles(INTERNAL)).find(f=>'file-'+crypto.createHash('sha256').update(f.path).digest('hex').slice(0,16)===id);if(!f)throw new Error('文件已移走');return within(INTERNAL,f.path);}
 if(id.startsWith('out-')){const f=(await listFiles(EXTERNAL)).find(f=>'out-'+crypto.createHash('sha256').update(f.path).digest('hex').slice(0,16)===id);if(!f)throw new Error('文件已移走');return within(EXTERNAL,f.path);}
 if(kind==='output'){const o=db.records.flatMap(r=>r.outputs||[]).find(x=>x.id===id);if(!o)throw new Error('未找到报价单');return within(EXTERNAL,o.path);}
 return within(INTERNAL,getRecord(id).path);
}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`127.0.0.1:${PORT}`){json(res,403,{error:'仅允许本机访问'});return;}
  if(req.headers.origin&&req.headers.origin!==ORIGIN){json(res,403,{error:'来源不允许'});return;}
  if(req.headers['sec-fetch-site']==='cross-site'){json(res,403,{error:'来源不允许'});return;}
  const url=new URL(req.url,ORIGIN),route=url.pathname;
  if(req.method==='GET'&&route==='/api/health'){json(res,200,{application:'hengsheng-quotation',version:'0.1.0'});return;}
  if(req.method==='GET'&&route==='/api/bootstrap'){json(res,200,{csrf,...await pool()});return;}
  if(req.method==='GET'&&route==='/api/pool'){json(res,200,await pool());return;}
  if(req.method==='GET'&&route==='/api/job'){json(res,200,jobs.get(url.searchParams.get('id'))||{status:'error',error:'任务记录已失效，请刷新列表。'});return;}
  if(req.method==='GET'&&route==='/api/source'){
    const r=getRecord(url.searchParams.get('id'));const source=r.sources?.[Number(url.searchParams.get('index'))];if(!source)throw new Error('未找到原资料');const file=await within(DATA,source.path);res.writeHead(200,{'Content-Type':source.mime||'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(source.name)}`,'X-Content-Type-Options':'nosniff'});res.end(await fs.readFile(file));return;
  }
  if(req.method==='GET'&&route==='/api/preview'){const o=db.records.flatMap(r=>r.outputs||[]).find(x=>x.id===url.searchParams.get('id'));if(!o)throw new Error('未找到预览');const file=await within(DATA,o.preview);res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});res.end(await fs.readFile(file));return;}
  if(req.method==='POST'){
   if(req.headers['x-hs-token']!==csrf){json(res,403,{error:'页面已过期，请刷新后重试。'});return;}
   const b=await body(req);
   if(route==='/api/settings'){
    const old=await getSettings();const next={...old,creator:String(b.creator??old.creator??'').slice(0,100),textModel:String(b.textModel??old.textModel??'').slice(0,200),visionModel:String(b.visionModel??old.visionModel??'').slice(0,200)};
    if(typeof b.apiKey==='string'&&b.apiKey.trim())next.apiKey=b.apiKey.trim();
    const models=await listModels(next);const picks=pickModels(models);if(!next.textModel)next.textModel=picks.textModel;if(!next.visionModel)next.visionModel=picks.visionModel;
    for(const k of ['textModel','visionModel'])if(next[k]&&!models.includes(next[k]))throw new Error('模型不在当前接口提供的模型列表中。');
    await atomicJSON(path.join(DATA,'secrets.json'),next);await atomicJSON(path.join(DATA,'models.json'),models);json(res,200,{settings:publicSettings(next),models});return;
   }
   if(route==='/api/models'){json(res,200,{models:await listModels(await getSettings())});return;}
   if(route==='/api/open'){await run('/usr/bin/open',[await resolveFile(String(b.id),b.kind)]);json(res,200,{ok:true});return;}
   if(route==='/api/folder'){await run('/usr/bin/open',[b.kind==='external'?EXTERNAL:INTERNAL]);json(res,200,{ok:true});return;}
   if(route==='/api/import'){
    if(!String(b.text||'').trim()&&(!Array.isArray(b.files)||!b.files.length))throw new Error('请先上传表格／图片，或粘贴询价文字。');
    if(String(b.text||'').length>100000||(b.files?.length||0)>8)throw new Error('一次最多8个文件，文字不超过10万字。');
    const id='Q-'+day().replaceAll('-','')+'-'+crypto.randomBytes(3).toString('hex').toUpperCase();const dir=path.join(DATA,id,'sources');await fs.mkdir(dir,{recursive:true});
    const r={id,created:new Date().toISOString(),status:'missing',sources:[],outputs:[],customer:'正在识别'};
    const images=[];let text=String(b.text||'');if(text){const file=path.join(dir,'询价文字.txt');await fs.writeFile(file,text);r.sources.push({name:'询价文字.txt',path:file,mime:'text/plain; charset=utf-8'});}
    for(const [i,f]of (b.files||[]).entries()){
     const name=safeName(f.name),ext=path.extname(name).toLowerCase();if(!['.xlsx','.xls','.csv','.png','.jpg','.jpeg','.webp'].includes(ext))throw new Error('支持 Excel、CSV 和 PNG/JPG/WebP 图片。');
     const bytes=Buffer.from(String(f.data||''),'base64');if(bytes.length>15*1024*1024)throw new Error('单个文件请控制在15MB以内。');const file=path.join(dir,i+'_'+name);await fs.writeFile(file,bytes);r.sources.push({name,path:file});
     if(['.png','.jpg','.jpeg','.webp'].includes(ext)){const mime=ext==='.png'?'image/png':ext==='.webp'?'image/webp':'image/jpeg';images.push('data:'+mime+';base64,'+bytes.toString('base64'));}else{text+='\n文件：'+name+'\n'+await run(PYTHON,[path.join(ROOT,'lib/read_source.py'),file]);}
    }
    db.records.push(r);await save();json(res,202,enqueue(r,'正在识别询价',()=>recognize(r,text,images)));return;
   }
   if(route==='/api/supplement'){const r=getRecord(b.id);const text=String(b.text||'').trim();if(!text)throw new Error('请填写需要补充的内容。');json(res,202,enqueue(r,'正在补充并核算',()=>recognize(r,text,[],r.extracted||r.input)));return;}
   if(route==='/api/generate'){const r=getRecord(b.id);json(res,202,enqueue(r,'正在读取已保存的 Excel',()=>generate(r)));return;}
   if(route==='/api/retry'){
    const r=getRecord(b.id);
    json(res,202,enqueue(r,'正在重新处理',async()=>{
     if(r.path){await generate(r);return;}
     if(r.extracted){const input=cleanInput(r.extracted,r.id);const check=await validateInput(input);if(check.errors.length){r.missing=check.errors;r.status='missing';return;}await internalBuild(r,input);return;}
     let text='',images=[];for(const source of r.sources){const file=await within(DATA,source.path),ext=path.extname(file).toLowerCase();if(['.png','.jpg','.jpeg','.webp'].includes(ext)){const mime=ext==='.png'?'image/png':ext==='.webp'?'image/webp':'image/jpeg';images.push('data:'+mime+';base64,'+(await fs.readFile(file)).toString('base64'));}else if(ext==='.txt')text+='\n'+await fs.readFile(file,'utf8');else text+='\n'+await run(PYTHON,[path.join(ROOT,'lib/read_source.py'),file]);}await recognize(r,text,images);
    }));return;
   }
   json(res,404,{error:'不存在的操作'});return;
  }
  if(req.method==='GET'&&['/','/index.html','/style.css','/app.js','/lucide.min.js'].includes(route)){
   const file=path.join(ROOT,'public',route==='/'?'index.html':route.slice(1));const mime=route.endsWith('.css')?'text/css':route.endsWith('.js')?'text/javascript':'text/html';res.writeHead(200,{'Content-Type':mime+'; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(await fs.readFile(file));return;
  }
  json(res,404,{error:'未找到页面'});
 }catch(e){json(res,400,{error:String(e.message).replace(/sk-[a-zA-Z0-9_-]+/g,'[已隐藏]').slice(0,2000)});}
});
server.listen(PORT,'127.0.0.1',()=>process.stdout.write(`trade flow 已启动：${ORIGIN}\n`));
