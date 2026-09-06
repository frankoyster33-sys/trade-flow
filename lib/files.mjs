import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
export const hash=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
export async function within(root,file){const r=await fs.realpath(root),p=await fs.realpath(file);if(p!==r&&!p.startsWith(r+path.sep))throw new Error('文件不在指定报价文件夹内。');return p;}
export async function listFiles(root){
 const out=[];async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink()||e.name.startsWith('.')||e.name.startsWith('~$'))continue;const file=path.join(dir,e.name);if(e.isDirectory())await walk(file);else if(e.isFile()&&e.name.endsWith('.xlsx')){const st=await fs.stat(file);out.push({path:file,name:e.name,modified:st.mtime.toISOString(),size:st.size});}}}
 try{await walk(root);}catch(e){if(e.code!=='ENOENT')throw e;}return out;
}
export async function publish(root,filename,staged){
 const real=await fs.realpath(root),target=path.join(real,filename);if(!target.startsWith(real+path.sep))throw new Error('无效输出路径');
 await fs.mkdir(path.dirname(target),{recursive:true});await within(root,path.dirname(target));
 await fs.copyFile(staged,target,fs.constants.COPYFILE_EXCL);return target;
}
