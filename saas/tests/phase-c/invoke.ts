import {pool} from '../../src/lib/db';
import {supportEntry} from '../../src/lib/billing-core';
if(process.env.DATABASE_URL!==process.env.TEST_DATABASE_URL||!new URL(process.env.DATABASE_URL||'http://invalid').pathname.match(/^\/phase_[cd]_[0-9]+_[a-f0-9]+$/))throw new Error('Owned Phase C test database required');
async function main(){
 try{const result=await supportEntry(JSON.parse(process.argv[2]));console.log(JSON.stringify({status:200,existing:result.existing}));}
 catch(e){console.log(JSON.stringify({status:(e as {status?:number}).status||500}));}
}
main().finally(()=>pool().end());
