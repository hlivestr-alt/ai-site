import {publishJobContent,contentPublicationBatch} from "../src/lib/content-publication";
import {contentPosterBatch} from "../src/lib/content-posters";
import {pool} from "../src/lib/db";
import {isContentApproved} from "../src/lib/content-eligibility";
const [workspaceId,jobId,count="1",versionId]=process.argv.slice(2);
async function main(){try{console.log(JSON.stringify(workspaceId==="--poster"?{posters:await contentPosterBatch(5,jobId||undefined)}:workspaceId==="--approved"?await isContentApproved(jobId,count,versionId):workspaceId&&jobId?await Promise.all(Array.from({length:Number(count)},()=>publishJobContent(workspaceId,jobId))):{published:await contentPublicationBatch(25),posters:await contentPosterBatch(5)}));}finally{await pool().end();}}
void main();
