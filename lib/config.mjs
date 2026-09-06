import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const DATA=process.env.HS_QUOTE_DATA || path.join(ROOT,'.data');
export const INTERNAL=process.env.HS_QUOTE_INTERNAL || path.join(os.homedir(),'Desktop','agent报价池');
export const EXTERNAL=process.env.HS_QUOTE_EXTERNAL || path.join(os.homedir(),'Desktop','agent 对外报价单池');
const bundledPython=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
export const PYTHON=process.env.HS_QUOTE_PYTHON || (existsSync(bundledPython)?bundledPython:'python3');
export const PORT=Number(process.env.HS_QUOTE_PORT || 60322);
export async function atomicJSON(file,value){
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=file+'.'+crypto.randomUUID()+'.tmp';
  await fs.writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600});
  await fs.rename(tmp,file);
}
export async function readJSON(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
export async function getSettings(){return readJSON(path.join(DATA,'secrets.json'),{provider:'SiliconFlow',textModel:'',visionModel:'',creator:''});}
export function publicSettings(s){return {provider:'SiliconFlow',configured:!!s.apiKey,textModel:s.textModel||'',visionModel:s.visionModel||'',creator:s.creator||'',internal:INTERNAL,external:EXTERNAL};}
export const day=(value=new Date())=>new Date(value).toLocaleDateString('sv-SE');
export const safeName=s=>String(s||'未命名').normalize('NFKC').replace(/[\x00-\x1f\\/:*?"<>|]/g,'_').replace(/^\.+/,'').slice(0,80)||'未命名';
