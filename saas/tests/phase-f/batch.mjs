import {spawn} from 'node:child_process';
import {open,writeFile,readFile} from 'node:fs/promises';
const suites=['browser','shared','variations','restart-variation','editor','isolation','focused','restart','phase-b','outreach','outreach-restart','outreach-browser','provider-browser','canary-browser','provider'];
const start=process.argv.includes('--from')?suites.indexOf(process.argv[process.argv.indexOf('--from')+1]):0;if(start<0)throw new Error('Unknown suite');
const progress={completed:[],current:null,failed:null};for(const suite of suites.slice(0,start)){const r=JSON.parse(await readFile(`docs/phase-f-evidence/${suite}-run.json`,'utf8'));if(r.exitCode!==0)throw new Error('Earlier suites must pass');progress.completed.push({suite,exitCode:0});}
for(const suite of suites.slice(start)){
  progress.current=suite;await writeFile('.next-tests/phase-f/progress.json',JSON.stringify(progress));console.log(`Starting ${suite}`);
  const file=await open(`.next-tests/phase-f/${suite}-harness.log`,'w');
  const exitCode=await new Promise(resolve=>{
    const p=spawn(process.execPath,['tests/phase-f/run.mjs','--suite',suite,'--app-port','3267','--storage-port','9067'],{windowsHide:true,stdio:['ignore',file.fd,file.fd]});
    p.on('error',()=>resolve(127));p.on('close',resolve);
  });await file.close();
  progress.completed.push({suite,exitCode});progress.current=null;
  if(exitCode!==0){progress.failed=suite;await writeFile('.next-tests/phase-f/progress.json',JSON.stringify(progress));process.exitCode=1;break;}
  await writeFile('.next-tests/phase-f/progress.json',JSON.stringify(progress));console.log(`${suite}: PASS`);
}
