import Link from "next/link";
import { StatusPage, primaryActionClass } from "@/components/status-page";

/** A Design page (#9) someone can't open: no such proposal, another organisation's, or not a member of this one. */
export default function DesignNotFound() {
  return (
    <StatusPage
      code="404"
      title="We couldn't find that design"
      actions={
        <Link href="/home" className={primaryActionClass}>
          Go to your issues
        </Link>
      }
    >
      <p>The link may be wrong, or the design may belong to an organisation you aren&apos;t a member of.</p>
    </StatusPage>
  );
}
