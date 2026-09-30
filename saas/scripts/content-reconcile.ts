import {contentPublicationBatch,publishJobContent} from "../src/lib/content-publication";
import {contentPosterBatch} from "../src/lib/content-posters";
import {pool} from "../src/lib/db";
import {isUuid} from "../src/lib/core";
const [workspaceId,jobId]=process.argv.slice(2);
async function main(){try{
  if(workspaceId||jobId){if(!workspaceId||!jobId||![workspaceId,jobId].every(isUuid))throw new Error("Use workspace UUID and job UUID");console.log(JSON.stringify({contentIds:await publishJobContent(workspaceId,jobId)}));}
  else console.log(JSON.stringify({published:await contentPublicationBatch(25),posters:await contentPosterBatch(5)}));
}finally{await pool().end();}}
void main();
