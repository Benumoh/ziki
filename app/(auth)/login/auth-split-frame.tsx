import type { ReactNode } from "react";
import { AuthPage } from "@/components/auth-page";
import { ZikiMark } from "@/components/ziki-mark";

/** Recovery and invite screens share the same chrome as sign-in and signup. */
export function AuthSplitFrame({
  children,
  panelLabel = "Sign in",
  title,
  description,
  mark = true,
}: {
  children: ReactNode;
  panelLabel?: string;
  title: string;
  description?: ReactNode;
  mark?: boolean;
}) {
  return (
    <AuthPage panelLabel={panelLabel}>
      <div className="flex flex-col gap-3">
        {mark ? <ZikiMark className="size-9 text-zk-blue" /> : null}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <div className="text-sm leading-relaxed text-zk-muted">{description}</div> : null}
      </div>
      {children}
    </AuthPage>
  );
}

export function AuthLegalNote() {
  return (
    <p className="text-center text-xs leading-relaxed text-zk-muted">
      By continuing, you agree to Ziki&apos;s{" "}
      <span className="font-semibold text-zk-accent">Terms</span> and{" "}
      <span className="font-semibold text-zk-accent">Privacy Policy</span>.
    </p>
  );
}
