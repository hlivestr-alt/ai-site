// Read only acceptance facts, never database rows, credentials or request bodies.
import {readFile, writeFile} from 'node:fs/promises';
const directory='docs/phase-f-evidence';
const suites=['integration','browser','shared','variations','restart-variation','editor','isolation','focused','restart','phase-b','outreach','outreach-restart','outreach-browser','provider','provider-browser','canary-browser'];
const counts={},titles=new Set();
for(const suite of suites){
 const run=JSON.parse(await readFile(`${directory}/${suite}-run.json`,'utf8'));
 const report=JSON.parse(await readFile(`test-data/phase-f/${suite}/playwright.json`,'utf8'));
 if(run.exitCode!==0||report.status!=='passed'||report.stats.unexpected||report.stats.skipped)throw new Error('All suites must pass without skips');
 if(['database','bucket','gateway'].some(k=>run.cleanup[k]!=='deleted'))throw new Error('Owned fixture cleanup must complete');
 if(Object.values(run.paid).some(n=>n!==0))throw new Error('Real operations are prohibited');
 counts[suite]=report.tests.length;
 for(const t of report.tests){if(t.retry||t.status!=='passed'||t.expectedStatus!=='passed')throw new Error('Acceptance cannot rely on retries');titles.add(t.title);}
 await writeFile(`${directory}/${suite}-tests.json`,JSON.stringify(report,null,2));
}
const unit=await readFile('.next-tests/phase-f/unit.log','utf8'),worker=await readFile('../worker-agent/data/phase-f-unit.log','utf8');
const unitCount=Number(unit.match(/tests (\d+)/)?.[1]),workerCount=Number(worker.match(/Ran (\d+) tests/)?.[1]);
if(!unitCount||!workerCount||!unit.includes('fail 0')||!worker.trimEnd().endsWith('OK'))throw new Error('Unit results must pass');
const earlierExecutions={};
for(const name of ['initial-provider','second-provider','initial-browser','initial-focused']){
 const report=JSON.parse(await readFile(`${directory}/${name}-tests.json`,'utf8'));
 earlierExecutions[name]={executions:report.tests.length,passed:report.tests.filter(t=>t.status==='passed').length,failed:report.tests.filter(t=>t.status==='failed').length};
}
const preliminary=JSON.parse(await readFile(`${directory}/preliminary-provider-result.json`,'utf8'));
earlierExecutions.preliminaryProvider={executions:preliminary.tests,passed:preliminary.passed,failed:preliminary.failed};
const finalTotal=unitCount+workerCount+Object.values(counts).reduce((a,b)=>a+b,0);
const results={status:'PASS',suites:counts,saasUnit:unitCount,workerUnit:workerCount,earlierExecutions,finalAcceptanceExecutionTotal:finalTotal,allRecordedExecutions:finalTotal+Object.values(earlierExecutions).reduce((n,r)=>n+r.executions,0),distinctTotal:unitCount+workerCount+titles.size,distinctMethod:'unit cases plus unique Playwright scenario titles',duplicateExecutions:Object.values(counts).reduce((a,b)=>a+b,0)-titles.size,allRetries:0,allSkipped:0,ownedFixturesRemoved:true,paid:{realVideo:0,realLLM:0,outreach:0,payments:0}};
await writeFile(`${directory}/test-summary.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
