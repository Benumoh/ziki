import Link from "next/link";
import { StatusPage, primaryActionClass } from "@/components/status-page";

export default function ProjectNotFound() {
  return (
    <StatusPage
      code="404"
      title="We couldn't find that project"
      actions={
        <Link href="/discover" className={primaryActionClass}>
          All Projects
        </Link>
      }
    >
      <p>The link may be wrong, or the project may no longer be available.</p>
    </StatusPage>
  );
}
