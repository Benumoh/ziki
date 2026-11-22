import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { twoFactorStatus } from "@/lib/two-factor";
import { isPasswordAuthEnabled } from "@/lib/auth-mode";
import { TwoFactorSettings } from "./two-factor-settings";

export const metadata = { title: "Security" };

export default async function SecuritySettingsPage() {
  const user = await requireUser();
  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  const hasPassword = Boolean(account?.passwordHash);
  const status = hasPassword ? await twoFactorStatus(user.id) : { enabled: false, backupCodesLeft: 0 };

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
        <p className="m-0 text-sm text-zk-muted">Protect your account with a second step at sign-in.</p>
      </div>

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
              A second step at sign-in so a stolen password is not enough.
            </span>
          </div>
        </div>
        {hasPassword ? (
          <>
            <p className="m-0 text-sm text-zk-text2">
              Ask for a 6-digit code from an authenticator app (such as Google Authenticator, 1Password
              or Authy) as well as your password, so a stolen or reused password is not enough to get in.
            </p>
            {!isPasswordAuthEnabled() ? (
              <p className="m-0 rounded-xl border border-zk-warn-bd bg-zk-warn-bg px-4 py-3 text-sm text-zk-warn-fg">
                Password sign-in is turned off on this site, so the code is not asked for here.
              </p>
            ) : null}
            <TwoFactorSettings enabled={status.enabled} backupCodesLeft={status.backupCodesLeft} />
          </>
        ) : (
          <p className="m-0 text-sm text-zk-text2">
            Your account signs in with Google, so turn on Google&apos;s 2-Step Verification in your Google
            account instead. There is no password here to protect.
          </p>
        )}
      </section>
    </div>
  );
}
