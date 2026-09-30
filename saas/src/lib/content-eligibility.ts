import {query,type DbClient} from "./db";
import {isUuid} from "./core";
// Internal server helper: callers must authorize their workspace before use.
export async function isContentApproved(workspaceId:string,id:string,versionId:string,db:DbClient={query}){
  if(![workspaceId,id,versionId].every(isUuid))return false;
  const r=await db.query(`SELECT i.id FROM content_items i WHERE i.workspace_id=$1 AND i.id=$2 AND i.current_version_id=$3 AND i.status='APPROVED'
    AND EXISTS(SELECT 1 FROM review_decisions d WHERE d.workspace_id=i.workspace_id AND d.content_item_id=i.id AND d.content_version_id=i.current_version_id AND d.review_revision=i.review_revision AND d.decision='APPROVE')`,[workspaceId,id,versionId]);
  return !!r.rowCount;
}
