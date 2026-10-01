import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requiredPageSession} from '@/lib/page';
import {isOperator,operationStatus} from '@/lib/operations';
import {OperationsConsole} from '@/components/operations-console';
export default async function OperationsPage(){const session=await requiredPageSession();if(!isOperator(session))notFound();return <main className="content"><Link href="/">Workspace</Link><h1>Platform operations</h1><p>Restricted support tools · {session.displayName}</p><OperationsConsole initial={await operationStatus()}/></main>;}
