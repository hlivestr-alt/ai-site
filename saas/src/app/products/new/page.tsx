import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { ProductWizard } from "@/components/product-wizard";
import { pageWorkspace } from "@/lib/page";
import { can, type Role } from "@/lib/permissions";
export default async function NewProduct(){const {session,workspaces,current}=await pageWorkspace();if(!can(current.role as Role,"future:edit"))redirect("/products");return <Shell user={session} workspaces={workspaces} current={current}><ProductWizard workspaceId={current.id} /></Shell>;}
