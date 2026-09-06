import fs from 'node:fs/promises';
import {buildInternal,readReviewed} from './workbooks.mjs';
try{
 const request=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
 const result=request.kind==='internal'?await buildInternal(request.input,request.file,request.options):await readReviewed(request.file,request.record);
 await fs.writeFile(request.resultFile,JSON.stringify(result));
 process.stdout.write('ok\n');
}catch(error){process.stderr.write(String(error.message).slice(0,2000));process.exitCode=1;}
