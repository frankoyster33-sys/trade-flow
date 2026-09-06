import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const BASE='http://127.0.0.1:60322';
const bootstrap=await(await fetch(BASE+'/api/bootstrap')).json();
assert.ok(bootstrap.settings.configured);assert.equal(bootstrap.settings.apiKey,undefined);assert.ok(!JSON.stringify(bootstrap).includes('sk-'));
assert.equal((await fetch(BASE+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
assert.equal((await fetch(BASE+'/api/bootstrap',{headers:{Origin:'https://example.test'}})).status,403);
assert.equal((await fetch(BASE+'/.data/secrets.json')).status,404);
async function api(route,body){const r=await fetch(BASE+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-HS-Token':bootstrap.csrf},body:JSON.stringify(body)});const data=await r.json();assert.ok(r.ok,data.error);return data;}
const mode=process.argv[2];
let result;
if(mode==='excel'){
 const file=await fs.readFile('.data/verification/TEST-inquiry.xlsx');result=await api('import',{text:'This is a fictional software verification inquiry. Use customer company TEST Excel Example Co. The two quantity rows are independent options.',files:[{name:'TEST-inquiry.xlsx',data:file.toString('base64')}]});
}else if(mode==='image-output')result=await api('generate',{id:'Q-20260906-C6AD46'});
if(result)console.log(JSON.stringify({jobId:result.jobId,recordId:result.recordId}));
console.log('HTTP checks passed: local origin, CSRF, no public credentials, private paths blocked.');
