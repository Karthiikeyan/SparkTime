import { redirect } from "next/navigation";
import { requireAdminPage } from "@/server/auth/guard";

/** Interview research is imported from Studio → Import, which recognises a company's import.json. */
export default async function InterviewImportPage() {
  await requireAdminPage();
  redirect("/admin/import");
}
