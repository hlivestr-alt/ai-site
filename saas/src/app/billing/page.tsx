import {Shell} from "@/components/shell";
import {BillingView} from "@/components/billing-view";
import {pageWorkspace} from "@/lib/page";
import {billingSummary,packages,paymentHistory,history,usage} from "@/lib/billing";
import {can,type Role} from "@/lib/permissions";
export default async function BillingPage(){const {session,workspaces,current}=await pageWorkspace(),canManage=can(current.role as Role,"billing:manage");const [wallet,catalog,payments,ledger,operations]=await Promise.all([billingSummary(session,current.id),canManage?packages(session,current.id):[],canManage?paymentHistory(session,current.id):{payments:[],nextCursor:null},history(session,current.id),usage(session,current.id)]);return <Shell user={session} workspaces={workspaces} current={current}><div className="page-heading"><div><p className="eyebrow">WORKSPACE WALLET</p><h1>Billing</h1><p>Tokens, payments, and paid operation history.</p></div></div><BillingView workspaceId={current.id} canManage={canManage} initial={wallet} packages={catalog} payments={payments.payments} initialPaymentCursor={payments.nextCursor} history={ledger} usage={operations}/></Shell>;}
