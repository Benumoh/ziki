"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { replaceScan } from "@/app/actions/security-assistant";

/**
 * A scan made before 18 Nov saved its quick scan only as a list of titles, so its findings had no tick box or Fix.
 * Opening it runs the quick scan again once (the same as Scan again's quick part, `replaceScan`), which now saves
 * each problem as a real finding (`saveCodeFindings`) with how to fix it. Then the page refreshes with tick boxes.
 * If it can't (the site is down, or the hourly scan limit is reached), it says how to do it by hand.
 */
export function MakeFixable({ checkId }: { checkId: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<"working" | "failed">("working");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    replaceScan(checkId).then(
      (answer) => {
        if (answer.ok) router.refresh();
        else setState("failed");
      },
      () => setState("failed"),
    );
  }, [checkId, router]);
  return (
    <p role="status" className="m-0 flex items-center gap-2 border-t border-zk-border bg-zk-tint/50 px-4 py-2.5 text-sm text-zk-text2 sm:px-6">
      {state === "working" ? (
        <>
          <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-electric-blue-strong border-r-transparent motion-safe:animate-spin" />
          Getting these ready to fix…
        </>
      ) : (
        <>This scan is from before findings could be fixed here. Use Scan again in the … menu to fix these.</>
      )}
    </p>
  );
}
