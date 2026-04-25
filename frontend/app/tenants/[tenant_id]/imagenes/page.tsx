import { redirect } from "next/navigation";

export default function TenantImagesRedirect({ params }: { params: { tenant_id: string } }) {
  redirect("/imagenes");
}
