import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {workflowTemplate,workflowBudget,runRequest,type WorkflowSnapshot} from "../../src/lib/workflow-templates";
process.env.APP_ENV="local";
const video={productId:randomUUID(),scripts:["A customer-authored morning routine showing the saved Product.","A customer-authored problem and solution creative brief."],videosPerScript:2,tier:"QUALITY",durationSeconds:5,aspectRatio:"1:1",maxTokens:"5000"};
test("controlled registry rejects arbitrary keys, providers, paths and workflow explosions",()=>{
  assert.throws(()=>workflowTemplate("ARBITRARY_GRAPH"));const template=workflowTemplate("PRODUCT_AI_VIDEO_REVIEW_V1");
  for(const override of [{provider:"OPENAI"},{storageKey:"private/object"},{scripts:Array(6).fill(video.scripts[0])},{videosPerScript:4},{durationSeconds:31},{maxTokens:"100001"}])assert.throws(()=>template.validateDefinition({...video,...override}));
  const config=template.validateDefinition(video);assert.equal(config.failurePolicy,"CONTINUE_PARTIAL");assert.equal(config.reviewPolicy,"ALL_REVIEWED_AT_LEAST_ONE_APPROVED");
});
test("deterministic fanout and step identities survive replay",()=>{
  const template=workflowTemplate("PRODUCT_AI_VIDEO_REVIEW_V1"),snapshot={configuration:template.validateDefinition(video),prepared:[{kind:"AI_VIDEO"},{kind:"AI_VIDEO"}]} as WorkflowSnapshot;
  assert.deepEqual(template.intendedChildren(snapshot).map(c=>c.childKey),["video:01:01","video:01:02","video:02:01","video:02:02"]);
  assert.deepEqual(template.planSteps(snapshot),template.planSteps(snapshot));assert.equal(new Set(template.planSteps(snapshot).map(s=>s.key)).size,12);
});
test("review policy requires decisions on exact outputs and at least one approval",()=>{
  const t=workflowTemplate("PRODUCT_AI_VIDEO_REVIEW_V1"),s={configuration:t.validateDefinition(video)} as WorkflowSnapshot;
  const out=(decision:"APPROVED"|"REJECTED"|"PENDING"|"UNAVAILABLE")=>({contentId:randomUUID(),versionId:randomUUID(),decision});
  assert.equal(t.reconcile(s,[out("APPROVED"),out("PENDING")]).state,"WAITING_FOR_REVIEW");assert.equal(t.reconcile(s,[out("APPROVED"),out("REJECTED")]).state,"SUCCEEDED");assert.equal(t.reconcile(s,[out("REJECTED")]).code,"NO_APPROVED_CONTENT");assert.equal(t.reconcile(s,[out("UNAVAILABLE")]).code,"CONTENT_VERSION_UNAVAILABLE");assert.equal(t.reconcile(s,[]).code,"NO_USABLE_CONTENT");
  s.configuration.reviewPolicy="ALL_APPROVED";assert.equal(t.reconcile(s,[out("APPROVED"),out("REJECTED")]).code,"REVIEW_POLICY_NOT_SATISFIED");
});
test("Clipper template reuses existing bounded validation and one intended child",()=>{
  const t=workflowTemplate("SOURCE_CLIPPER_REVIEW_V1"),c={sourceAssetId:randomUUID(),goal:"Useful ideas",targetClipCount:2,minClipSeconds:10,maxClipSeconds:30,captions:true,maxTokens:"5000"};
  const configuration=t.validateDefinition(c);assert.equal(configuration.failurePolicy,"FAIL_FAST");assert.throws(()=>t.validateDefinition({...c,targetClipCount:11}));assert.throws(()=>t.validateDefinition({...c,minClipSeconds:40}));assert.equal(t.intendedChildren({configuration,prepared:[{kind:"CLIPPER"}]} as WorkflowSnapshot).length,1);
});
test("run keys and budgets are bounded and production requires an explicit ceiling",()=>{
  assert.throws(()=>runRequest({idempotencyKey:"short"}));assert.throws(()=>runRequest({idempotencyKey:randomUUID(),rawPath:"C:/input.mp4"}));assert.throws(()=>workflowBudget("99999999999999999"));assert.throws(()=>workflowBudget("1.5"));
  const prior=process.env.WORKFLOW_MAX_TOKENS;delete process.env.WORKFLOW_MAX_TOKENS;process.env.APP_ENV="production";try{assert.throws(()=>workflowBudget("100"));process.env.WORKFLOW_MAX_TOKENS="1000";assert.equal(workflowBudget("1000"),"1000");assert.throws(()=>workflowBudget("1001"));}finally{process.env.APP_ENV="local";if(prior===undefined)delete process.env.WORKFLOW_MAX_TOKENS;else process.env.WORKFLOW_MAX_TOKENS=prior;}
});
