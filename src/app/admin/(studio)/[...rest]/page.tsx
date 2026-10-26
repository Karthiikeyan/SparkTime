import { notFound } from "next/navigation";
import { requireAdminPage } from "@/server/auth/guard";

/** Unknown studio URLs: authenticate first (no probing), then a real 404. */
export default async function AdminCatchAll() {
  await requireAdminPage();
  notFound();
}
