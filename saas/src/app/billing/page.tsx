import {Shell} from "@/components/shell";
import {BillingView} from "@/components/billing-view";
import {pageWorkspace} from "@/lib/page";
import {billingSummary,packages,paymentHistory,history,usage} from "@/lib/billing";
import {paymentsConfigured} from "@/lib/payment-providers";
export default async function BillingPage(){const {session,workspaces,current}=await pageWorkspace(),wallet=await billingSummary(session,current.id),canManage=wallet.canManage;const [catalog,payments,ledger,operations]=await Promise.all([canManage?packages(session,current.id):[],canManage?paymentHistory(session,current.id):{payments:[],nextCursor:null},history(session,current.id),usage(session,current.id)]);return <Shell user={session} workspaces={workspaces} current={current}><div className="page-heading"><div><p className="eyebrow">ACCOUNT BALANCE</p><h1>Billing</h1><p>Shared across your workspaces · {wallet.accountName}</p></div></div><BillingView paymentsAvailable={paymentsConfigured()} workspaceId={current.id} canManage={canManage} initial={wallet} packages={catalog} payments={payments.payments} initialPaymentCursor={payments.nextCursor} history={ledger} usage={operations}/></Shell>;}
