import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {parse} from '@babel/parser';
// Copy only specs into an ignored owned directory. Preserve A-E source/evidence.
for(const suite of ['integration','browser','stabilization','phase-b','phase-c','phase-d','phase-e']){
  const target=`.next-tests/phase-f-regressions/tests/${suite}`;
  await mkdir(target,{recursive:true});
  for(const name of await readdir(`tests/${suite}`)){
    if(!name.endsWith('.spec.ts'))continue;
    const source=`tests/${suite}/${name}`;
    let code=await readFile(source,'utf8');
    // Wait for onboarding to commit before this older UI test reads its session.
    if(name==='ai-video-journey.spec.ts')code=code.replace('const ws=(await', 'await expect(page.getByLabel("Switch workspace")).toBeVisible();\n  const ws=(await');
    // Resolve actual module imports only; inline child-process scripts use the cwd.
    const edits=[];
    const visit=node=>{
      if(!node||typeof node!=='object')return;
      const literal=['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)?node.source:node.type==='CallExpression'&&node.callee?.type==='Import'?node.arguments?.[0]:null;
      if(literal?.type==='StringLiteral'&&literal.value.startsWith('.'))edits.push({start:literal.start,end:literal.end,value:JSON.stringify(resolve(dirname(source),literal.value).replaceAll('\\','/'))});
      for(const [key,value] of Object.entries(node))if(!['loc','extra','comments'].includes(key)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}
    };
    visit(parse(code,{sourceType:'module',plugins:['typescript','jsx']}));
    for(const edit of edits.sort((a,b)=>b.start-a.start))code=code.slice(0,edit.start)+edit.value+code.slice(edit.end);
    code=code.replace('/phase-[cde]/','/phase-[cdef]/');
    code=code.replace(/docs\/(?:phase-[bcde]-evidence|stabilization-phase-[ab]-evidence)/g,'docs/phase-f-evidence');
    code=code.replace(/data\/phase[1-9](?=\/)/g,'test-data/phase-f/legacy-artifacts');
    await writeFile(`${target}/${name}`,code);
  }
}
