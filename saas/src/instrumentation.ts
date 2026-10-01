export async function register(){if(process.env.NEXT_RUNTIME==='nodejs'){const {assertRuntimeConfiguration}=await import('./lib/operational-config');assertRuntimeConfiguration();}}
