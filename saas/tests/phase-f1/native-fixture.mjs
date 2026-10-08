// Isolated acceptance entry point. Never imported by either production application.
import {createRequire} from 'node:module';
const root=process.env.NATIVE_PROJECT_ROOT,require=createRequire(root+'/apps/api/package.json');
if(process.env.RUNTIME_ENV!=='test'||!new URL(process.env.DATABASE_URL).pathname.startsWith('/phase_e_native_')||process.env.APP_MODE!=='read_only'||process.env.OUTBOUND_MODE!=='read_only')throw new Error('NATIVE_ISOLATED_FIXTURE_REQUIRED');
require('reflect-metadata');
const {Module,Controller,Get}=require('@nestjs/common'),{NestFactory}=require('@nestjs/core'),{FastifyAdapter}=require('@nestjs/platform-fastify');
const {IntegrationsController}=require(root+'/apps/api/dist/integrations/integrations.controller.js'),{TikTokIntegrationService}=require(root+'/apps/api/dist/integrations/tiktok.service.js'),{PrismaService}=require(root+'/apps/api/dist/shared.js'),{TikTokReadGovernor}=require(root+'/apps/api/dist/integrations/tiktok-read-governor.js'),{CreatorIdentityResolver}=require(root+'/apps/api/dist/identity/creator-identity-resolver.service.js'),{SafeExceptionFilter}=require(root+'/apps/api/dist/safe-exception.filter.js');
const baseFetch=globalThis.fetch;let tokenCalls=0,shopCalls=0;
globalThis.fetch=async(input,init)=>{
 const u=new URL(String(input));
 if(u.origin===process.env.TIKTOK_OAUTH_ROUTER_ORIGIN&&u.pathname==='/api/outreach/tiktok/native/register')return baseFetch(input,init);
 if(u.origin==='https://auth.example.test'&&u.pathname==='/api/v2/token/get'){
  tokenCalls++;if(u.searchParams.get('auth_code')?.startsWith('fail_'))throw new Error(u.searchParams.get('auth_code'));
  return Response.json({code:0,data:{access_token:process.env.FIXTURE_NATIVE_ACCESS,refresh_token:process.env.FIXTURE_NATIVE_REFRESH,access_token_expire_in:Math.floor(Date.now()/1000)+3600,refresh_token_expire_in:Math.floor(Date.now()/1000)+86400,open_id:'controlled_native_seller',user_type:0,granted_scopes:['seller.creator_marketplace.read','seller.affiliate_messages.write']}});
 }
 if(u.origin==='https://api.example.test'&&u.pathname==='/authorization/202309/shops'){
  shopCalls++;return Response.json({code:0,data:{shops:[{id:'controlled_native_shop',cipher:process.env.FIXTURE_NATIVE_CIPHER,name:'Controlled native fixture shop',region:'ID'}]},request_id:'controlled_fixture_request'});
 }
 throw new Error('UNEXPECTED_FIXTURE_HTTP_OPERATION');
};
class FixtureController {health(){return {status:'PASS',tokenCalls,shopCalls,realProviderRequests:0};}system(){return {outbound:{runtime:{mode:'READ_ONLY',mutationCapability:false}}};}}
Controller()(FixtureController);Get('fixture/health')(FixtureController.prototype,'health',Object.getOwnPropertyDescriptor(FixtureController.prototype,'health'));Get('api/v1/system/status')(FixtureController.prototype,'system',Object.getOwnPropertyDescriptor(FixtureController.prototype,'system'));
class FixtureModule {}Module({controllers:[IntegrationsController,FixtureController],providers:[PrismaService,TikTokIntegrationService,TikTokReadGovernor,CreatorIdentityResolver]})(FixtureModule);
const app=await NestFactory.create(FixtureModule,new FastifyAdapter({bodyLimit:16384}),{logger:['error','warn']});
app.enableCors({origin:[process.env.TIKTOK_OAUTH_OPERATOR_ORIGIN]});app.useGlobalFilters(new SafeExceptionFilter());
await app.listen(Number(process.env.PORT),'127.0.0.1');console.log('Native isolated OAuth fixture ready.');
