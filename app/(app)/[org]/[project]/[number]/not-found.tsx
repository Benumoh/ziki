import Link from "next/link";
import { auth } from "@/auth";
import { IssueSignInLink } from "@/components/issue-sign-in-link";
import {
  StatusPage,
  primaryActionClass,
  secondaryActionClass,
} from "@/components/status-page";

/**
 * Shown when an issue page calls notFound(), e.g. an issue id that doesn't
 * exist or was deleted (#214). Anonymous
 * visitors (link-preview fallbacks) get a sign-in link, because the issue may simply need a
 * session to view; it returns them to the issue they asked for (#457).
 */
export default async function IssueNotFound() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  return (
    <StatusPage
      code="404"
      title="We couldn't find that issue"
      actions={
        <>
          <Link href="/home" className={primaryActionClass}>
            Go to your issues
          </Link>
          {signedIn ? null : <IssueSignInLink className={secondaryActionClass} />}
        </>
      }
    >
      <p>
        The link may be wrong, or the issue may have been deleted.
        {signedIn ? null : " Some issues are only visible after you sign in."}
      </p>
    </StatusPage>
  );
}
