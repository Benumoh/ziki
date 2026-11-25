import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { GOOGLE_SECURITY_COOKIE } from "@/lib/google-auth-cookies";
import { readGoogleSecurityProof } from "@/lib/google-security";
import { isRecentGoogleAuthentication } from "@/lib/google-authentication";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { twoFactorStatus } from "@/lib/two-factor";
import { isPasswordAuthEnabled } from "@/lib/auth-mode";
import { TwoFactorSettings } from "./two-factor-settings";
import { SignInMethods } from "@/components/sign-in-methods";
import { isGoogleOAuthConfigured } from "@/lib/google-oauth";

export const metadata = { title: "Security" };

export default async function SecuritySettingsPage({ searchParams }: {
  searchParams: Promise<{ google?: string; googleSecurity?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true, googleSubject: true, email: true },
  });
  const hasPassword = Boolean(account?.passwordHash);
  const status = await twoFactorStatus(user.id);
  const session = await auth();
  const proof = await readGoogleSecurityProof((await cookies()).get(GOOGLE_SECURITY_COOKIE)?.value, session?.user);
  const verifiedFor = proof && proof.operation === params.googleSecurity ? proof.operation : undefined;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pb-10">
      <div className="flex flex-col gap-2.5">
        <Link
          href="/settings?section=account"
          className="inline-flex min-h-8 items-center gap-1.5 self-start text-sm font-semibold text-zk-accent hover:underline"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to settings
        </Link>
        <h1 className="m-0 text-[28px] font-extrabold tracking-[-0.02em] text-zk-text">Security</h1>
        <p className="m-0 text-sm text-zk-muted">Manage your sign-in methods and protect your account with a second step.</p>
      </div>

      {params.google === "linked" ? <p role="status" className="rounded-panel bg-zk-tint p-3 text-sm text-zk-accent">Google is connected. You can keep signing in with your password too.</p> : null}
      {params.google === "mismatch" ? <p role="alert" className="rounded-panel bg-zk-bad-bg p-3 text-sm text-zk-bad-fg">Google was not connected. Choose the Google account with your sign-in email, or confirm your password again if the request expired.</p> : null}
      {params.google === "securityMismatch" ? <p role="alert" className="rounded-panel bg-zk-bad-bg p-3 text-sm text-zk-bad-fg">Google verification failed. Choose the Google account connected to this account and try again.</p> : null}
      <SignInMethods hasPassword={hasPassword} googleLinked={Boolean(account?.googleSubject)}
        passwordSetupRequested={verifiedFor === "password"}
        googleConfigured={isGoogleOAuthConfigured()} passwordEnabled={isPasswordAuthEnabled()}
        passwordVerified={verifiedFor === "password" || isRecentGoogleAuthentication(session?.user)}
        twoFactorEnabled={status.enabled} email={account?.email ?? user.email ?? ""} />

      <section className="flex flex-col gap-4 rounded-panel border border-zk-border bg-zk-surface p-6">
        <div className="flex items-center gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zk-tint text-zk-accent">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-lg font-bold text-zk-text">Two-factor sign-in</h2>
            <span className="text-[13px] text-zk-muted">
              An authenticator code after Google or password sign-in.
            </span>
          </div>
        </div>
        <p className="m-0 text-sm text-zk-text2">
          Use an authenticator app (such as Google Authenticator, 1Password or Authy) to add
          a second step after signing in. A password is optional when you use Google.
        </p>
        <TwoFactorSettings enabled={status.enabled}
          backupCodesLeft={status.backupCodesLeft} hasPassword={hasPassword} googleVerifiedFor={verifiedFor} />
      </section>
    </div>
  );
}
