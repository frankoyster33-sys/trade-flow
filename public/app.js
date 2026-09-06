(() => {
 const root=document.getElementById('hs-quotation-pool'),el=id=>document.getElementById('hs-'+id);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const icon=n=>`<i data-lucide="${n}" aria-hidden="true"></i>`;
 const icons=()=>globalThis.lucide?.createIcons({attrs:{width:16,height:16}});
 const state={view:'internal',filter:'all',query:'',date:'all',weekly:false,records:[],externalFiles:[],settings:{},token:'',models:[]};
 const labels={review:'待审核',edited:'已修改',missing:'待补充',done:'已生成',generating:'处理中',error:'文件未找到',unlinked:'待关联'};
 const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v:new Date(v||Date.now()).toLocaleDateString('sv-SE');
 const stamp=v=>new Date(v).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
 async function api(route,data){const response=await fetch('/api/'+route,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json','X-HS-Token':state.token},...(data===undefined?{}:{body:JSON.stringify(data)})});const result=await response.json();if(!response.ok)throw new Error(result.error||'操作失败');return result;}
 function notice(title,detail='',output=false){el('notice-title').textContent=title;el('notice-detail').textContent=detail;el('notice-link').hidden=!output;el('pool-notice').hidden=false;}
 async function refresh(){const data=await api('pool');Object.assign(state,data);render();}
 function matches(row,date){if(state.date==='today'&&day(date)!==day())return false;if(state.date==='week'&&day(date)<day(Date.now()-6*86400000))return false;return [row.id,row.customer,row.product,row.spec,row.fileName].join(' ').toLowerCase().includes(state.query.toLowerCase());}
 function action(id,text,cls='',disabled=false,extra=''){return `<button type="button" class="hs-button ${cls}" data-action="${id}" ${disabled?'disabled':''} ${extra}>${text}</button>`;}
 function render(){
  document.querySelectorAll('[data-view]').forEach(b=>{if(b.dataset.view===state.view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  el('pool-title').textContent={internal:'内部报价池',external:'对外报价单',overview:'概览'}[state.view];
  el('pool-description').textContent={internal:'在 Excel 中审核并保存后，即可生成对外报价单。',external:'对应每次审核结果，按日期保存独立的报价单。',overview:'导入客户资料，让 Agent 完成提取与核算。'}[state.view];
  el('pool-list-section').hidden=state.view==='overview';el('pool-overview').hidden=state.view!=='overview';el('import-link').hidden=state.view==='overview';
  el('settings').textContent=state.settings.configured?'模型设置':'连接模型';
  if(state.view==='overview'){summary();icons();return;}
  const external=state.view==='external';
  const filters=external?[['all','全部']]:[['all','全部'],['review','待审核'],['edited','已修改'],['missing','待补充'],['done','已生成']];
  el('pool-filters').innerHTML=filters.map(([id,title])=>`<button type="button" data-filter="${id}" aria-pressed="${state.filter===id}">${title}${!external?` <span>${id==='all'?state.records.length:state.records.filter(r=>r.status===id).length}</span>`:''}</button>`).join('');
  let rows=external?state.records.flatMap(r=>r.outputs.map(o=>({...r,...o,recordId:r.id,id:o.id,status:'done',modified:o.date,date:o.date,notice:'',error:'',spec:o.items.map(x=>`${Number(x.quantity).toLocaleString()} pcs · ${o.currency} ${x.unitPrice}/pcs`).join('；')}))):state.records;
  if(external)rows=rows.concat(state.externalFiles.map(f=>({...f,id:f.id,recordId:'',customer:f.fileName,product:'文件夹中的报价单',status:'done',modified:f.date,date:f.date})));
  rows=rows.filter(r=>matches(r,external?r.date:r.date)&&(state.filter==='all'||r.status===state.filter)).sort((a,b)=>b.modified.localeCompare(a.modified));
  let last='';el('pool-rows').innerHTML=rows.map(r=>{let heading='';const date=day(r.date);if(date!==last){heading=`<div class="hs-date-heading">${esc(date)}${date===day()?' · 今天':''}</div>`;last=date;}
    return heading+`<article class="hs-quote-row" data-id="${esc(r.id)}"><div class="hs-file"><div class="hs-file-icon">${icon('file-spreadsheet')}</div><div class="hs-file-copy"><strong class="hs-file-title">${esc(r.customer)}${external?'':` · ${esc(r.product)}`}</strong><p class="hs-file-meta">${esc(external?r.quoteNo||r.fileName:r.id)}${r.spec?' · '+esc(r.spec):''}</p><p class="hs-mobile-save">${stamp(r.modified)}</p>${r.error?`<p class="hs-progress hs-error">${esc(r.error)}</p>`:''}${r.progress?`<p class="hs-progress">${esc(r.progress)}</p>`:''}${r.notice&&!r.error?`<p class="hs-progress">${esc(r.notice)}</p>`:''}</div></div><div class="hs-saved">${stamp(r.modified)}<small>${external?'生成时间':'Excel 保存时间'}</small></div><div class="hs-status is-${r.status}"><span class="hs-status-label">${labels[r.status]||r.status}</span>${r.status==='missing'?'<small>资料有缺项</small>':''}</div><div class="hs-row-actions">${external?action('output',icon('file-spreadsheet')+' 打开报价单','hs-review-action',false,`data-kind="output"`)+(r.quoteNo?action('preview','预览','hs-subtle'):''):r.status==='missing'&&!r.hasFile?action('supplement','补充资料','hs-review-action',r.status==='generating'):action('open',icon('square-pen')+' 审核／修改','hs-review-action',!r.hasFile)+action('generate',r.status==='generating'?'处理中':'生成','hs-primary hs-generate-action',!r.hasFile||r.status==='generating'||r.status==='unlinked')}${!external&&r.sourceCount?action('sources','原资料','hs-subtle'):''}</div></article>`;}).join('')||`<div class="hs-empty"><strong>${state.query?'未找到匹配的报价':external?'还没有对外报价单':'还没有内部报价'}</strong>${state.query?'尝试客户名称、编号或规格。':external?'审核内部 Excel 后，点击生成即可出单。':'从概览导入 Excel、图片或文字即可开始。'}</div>`;
  el('pool-count').textContent=`共 ${rows.length} 份${external?'对外报价单':'询价'}`;
  icons();
 }
 function summary(){const from=state.weekly?day(Date.now()-6*86400000):day();const rows=state.records.filter(r=>day(r.date)>=from||r.outputs.some(o=>day(o.date)>=from));el('summary-title').textContent=state.weekly?'近 7 天报价汇总':'今日报价汇总';el('summary-toggle').innerHTML=(state.weekly?'查看今天':'查看本周')+icon('arrow-right');el('summary-list').innerHTML=rows.map(r=>`<li><button type="button" class="hs-plain-button" data-summary="${esc(r.id)}">${esc(r.customer)} · ${esc(r.product)} · ${r.outputs.filter(o=>day(o.date)>=from).length} 份出单 · ${labels[r.status]||r.status}</button></li>`).join('')||'<li>这一期间还没有报价记录。</li>';}
 function view(name){state.view=name;state.filter='all';state.query='';el('pool-search').value='';render();window.scrollTo({top:0,behavior:'auto'});}
 function dialog(title,html,buttons){el('dialog-title').textContent=title;el('dialog-body').innerHTML=html;el('dialog-actions').innerHTML=buttons;el('pool-dialog').showModal();icons();}
 function close(){el('pool-dialog').close();el('dialog-body').replaceChildren();el('dialog-actions').replaceChildren();}
 async function waitJob(jobId){let job;do{await new Promise(resolve=>setTimeout(resolve,1800));job=await api('job?id='+encodeURIComponent(jobId));await refresh();}while(['queued','running'].includes(job.status));if(job.status==='error')throw new Error(job.error);const r=state.records.find(x=>x.id===job.recordId);notice(r?.notice||(r?.status==='missing'?'有几项资料需要补充':'内部 Excel 已生成'),r?.status==='missing'?'点击“补充资料”，只需说明缺少的部分。':'可以在列表中继续操作。',!!r?.outputs.length);}
 async function execute(fn){try{await fn();}catch(e){notice('未完成：'+e.message);}}
 async function settings(){
  const s=state.settings;dialog('硅基流动 · 模型设置',`<p>密钥保存在这台电脑的服务端。图片与询价内容会发送至硅基流动进行识别。</p><label class="hs-field">API 密钥<input id="hs-api-key" type="password" autocomplete="new-password" placeholder="${s.configured?'已保存，留空则继续使用':'填写 API 密钥'}"></label><label class="hs-field">文字模型<input id="hs-text-model" list="hs-model-list" value="${esc(s.textModel)}" placeholder="连接后自动选择"></label><label class="hs-field">图片模型<input id="hs-vision-model" list="hs-model-list" value="${esc(s.visionModel)}" placeholder="连接后自动选择视觉模型"></label><datalist id="hs-model-list">${state.models.map(m=>`<option value="${esc(m)}">`).join('')}</datalist><label class="hs-field">系统构思与设计署名<input id="hs-creator" value="${esc(s.creator)}" placeholder="你的署名"></label><p id="hs-settings-result" role="status"></p>`,action('save-settings','保存并测试连接','hs-primary')+action('close','取消'));
  if(s.configured&&!state.models.length){try{state.models=(await api('models',{})).models;if(el('model-list'))el('model-list').innerHTML=state.models.map(m=>`<option value="${esc(m)}">`).join('');}catch{}}
 }
 root.addEventListener('click',event=>{const btn=event.target.closest('button');if(!btn||btn.disabled)return;
  if(btn.dataset.view){view(btn.dataset.view);return;}if(btn.dataset.filter){state.filter=btn.dataset.filter;render();return;}
  if(btn.dataset.summary){view('internal');state.query=btn.dataset.summary;el('pool-search').value=state.query;render();return;}
  const act=btn.dataset.action;if(!act)return;
  execute(async()=>{
   if(act==='close'){close();return;}
   if(act==='save-settings'){const original=btn.textContent;btn.disabled=true;btn.textContent='正在验证…';try{const data=await api('settings',{apiKey:el('api-key').value,textModel:el('text-model').value.trim(),visionModel:el('vision-model').value.trim(),creator:el('creator').value.trim()});el('api-key').value='';state.settings=data.settings;state.models=data.models;close();render();notice('硅基流动已连接',`文字：${data.settings.textModel}；图片：${data.settings.visionModel||'尚未选择'}`);}catch(e){el('api-key').value='';el('settings-result').textContent=e.message;btn.disabled=false;btn.textContent=original;}return;}
   if(act==='folder'){await api('folder',{kind:btn.dataset.kind});return;}
   const id=btn.closest('[data-id]')?.dataset.id||btn.dataset.id;
   if(act==='open'||act==='output'){await api('open',{id,kind:act==='output'?'output':'internal'});if(act==='open')notice('已打开内部 Excel','审核后保存并关闭 Excel，再回到这里点击“生成”。');return;}
   if(act==='generate'){const result=await api('generate',{id});notice('正在读取你保存的 Excel','完成后会自动更新报价池。');await refresh();await waitJob(result.jobId);return;}
   if(act==='retry'){const result=await api('retry',{id});close();await refresh();await waitJob(result.jobId);return;}
   if(act==='supplement'){const r=state.records.find(x=>x.id===id);dialog('只补充缺少的资料',`<p>已识别的信息会保留，无需重新输入。</p><ul>${r.missing.map(m=>`<li>${esc(m)}</li>`).join('')}</ul><textarea id="hs-supplement-text" aria-label="补充资料" placeholder="例如：每箱2500个，印刷覆盖率20%，铜版2块"></textarea>`,action('submit-supplement','补充并继续核价','hs-primary',false,`data-id="${esc(id)}"`)+action('retry','重新处理','',false,`data-id="${esc(id)}"`)+action('close','取消'));return;}
   if(act==='submit-supplement'){const text=el('supplement-text').value;const result=await api('supplement',{id,text});close();await refresh();await waitJob(result.jobId);return;}
   if(act==='sources'){const r=state.records.find(x=>x.id===id);dialog('原始询价资料',`<p>客户导入的文件／文字保留在本机。“识别来源”工作表可对照每个字段。</p><div class="hs-source-list">${Array.from({length:r.sourceCount},(_,i)=>`<a href="/api/source?id=${encodeURIComponent(id)}&index=${i}" download>下载原资料 ${i+1}</a>`).join('')}</div>`,action('close','关闭'));return;}
   if(act==='preview'){dialog('对外报价单预览',`<img class="hs-preview-img" src="/api/preview?id=${encodeURIComponent(id)}" alt="对外 Quotation Sheet 预览">`,action('output','打开 Excel','hs-primary',false,`data-id="${esc(id)}"`)+action('close','关闭'));return;}
  });
 });
 el('import-link').onclick=()=>view('overview');el('notice-close').onclick=()=>{el('pool-notice').hidden=true;};el('notice-link').onclick=()=>view('external');
 el('pool-search').addEventListener('input',e=>{state.query=e.target.value;render();});el('pool-date').onchange=e=>{state.date=e.target.value;render();};
 el('summary-toggle').onclick=()=>{state.weekly=!state.weekly;summary();icons();};
 el('text-tab').onclick=()=>{el('demo-text').hidden=false;el('demo-text').focus();};el('upload-tab').onclick=()=>el('demo-file').click();
 el('settings').onclick=()=>execute(settings);el('dialog-close').onclick=close;
 el('about').onclick=()=>dialog('关于 trade flow',`<p>导入询价 → Agent 核算 → Excel 审核 → 对外报价单。</p><div class="hs-about-credit">系统构思与设计：${esc(state.settings.creator||'［你的署名］')}</div><p>版本 0.1 · 本机工作版</p><p>内部报价池：${esc(state.settings.internal)}</p><p>对外报价池：${esc(state.settings.external)}</p><p>规则版本：2026-09-06。使用现有批量核算与对外报价单技能。</p>`,action('folder','打开内部文件夹','',false,'data-kind="internal"')+action('folder','打开对外文件夹','',false,'data-kind="external"')+action('close','关闭'));
 const readFile=file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve({name:file.name,data:String(r.result).split(',')[1]});r.onerror=reject;r.readAsDataURL(file);});
 el('start-demo').onclick=()=>execute(async()=>{
  if(!state.settings.configured){await settings();return;}
  const button=el('start-demo');button.disabled=true;try{const files=await Promise.all([...el('demo-file').files].map(readFile));const result=await api('import',{text:el('demo-text').value,files});el('demo-file').value='';el('demo-text').value='';view('internal');notice('已接收询价，正在识别并核算');await refresh();await waitJob(result.jobId);}finally{button.disabled=false;}
 });
 window.addEventListener('focus',()=>execute(refresh));
 el('pool-dialog').addEventListener('cancel',()=>{setTimeout(()=>el('dialog-body').replaceChildren(),0);});
 api('bootstrap').then(data=>{state.token=data.csrf;Object.assign(state,data);render();if(!state.settings.configured)notice('先连接大模型，即可开始自动报价','点击右上角“连接模型”完成设置。');}).catch(e=>notice('连接本机服务失败',e.message));
 setInterval(()=>{if(document.visibilityState==='visible'&&!el('pool-dialog').open)refresh().catch(()=>{});},15000);
})();
