"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { savedPublicSubmissions, forgetPublicSubmissions } from "@/lib/saved-public-submissions";

export function PublicSubmissionsSync() {
  const router = useRouter();
  const started = useRef(false);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const reports = savedPublicSubmissions();
    if (!reports.length) return;
    queueMicrotask(() => setMessage("Adding reports submitted from this browser…"));
    fetch("/api/public/submissions/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reports }) })
      .then(async response => {
        if (!response.ok) throw new Error("Your saved reports could not be added. Your tracking links still work.");
        const result = await response.json();
        forgetPublicSubmissions(reports.map(report => report.token));
        setMessage("");
        if (result.claimed > 0) router.refresh();
      }).catch(error => setMessage(error instanceof Error ? error.message : "Please try again."));
  }, [router, retry]);
  return message ? <p role="status" className="text-sm text-zk-muted">{message} {message.includes("could not") ? <button type="button" className="font-semibold text-zk-accent hover:underline" onClick={() => { started.current = false; setRetry(value => value + 1); }}>Try again</button> : null}</p> : null;
}
