import base from './playwright.config';
import {defineConfig} from '@playwright/test';
process.env.PHASE9_OPERATOR_EMAIL||=`phase9-operator-${Date.now()}@example.test`;
const server=Array.isArray(base.webServer)?base.webServer[0]:base.webServer!;
export default defineConfig({...base,testIgnore:[],testMatch:['**/integration/phase9.spec.ts'],timeout:180000,webServer:{...server,env:{...server.env,PLATFORM_OPERATOR_EMAILS:process.env.PHASE9_OPERATOR_EMAIL,RATE_LIMIT_INVITE:'2',RATE_LIMIT_WINDOW_SECONDS:'900'}}});
