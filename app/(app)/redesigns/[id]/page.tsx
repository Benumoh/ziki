import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { designAddressFor } from "@/lib/redesign-read";

export const metadata = { title: "Review redesign" };

/**
 * An old proposal address, from Escalations and the "needs your approval"
 * email: it opens the proposal's page in its project's Design area (#9), which
 * shows the preview and mockups too. Only a member of the proposal's
 * organisation is sent on; anyone else gets this segment's 404.
 */
export default async function RedesignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const address = await designAddressFor(user, id);
  if (!address) notFound();
  redirect(address);
}
