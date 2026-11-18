"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function DiscoverError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="rounded-2xl border border-zk-border bg-zk-surface p-8 text-center">
        <h1 className="text-xl font-bold text-zk-text">Unable to load projects</h1>
        <p className="mt-2 text-sm text-zk-text2">
          Something went wrong while loading the public project directory.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button type="button" variant="primary" onClick={reset}>
            Try again
          </Button>
          <Link href="/" className="inline-flex items-center rounded-xl border border-zk-border px-4 py-2 text-sm font-semibold text-zk-text hover:bg-zk-chip">
            Back home
          </Link>
        </div>
      </div>
    </div>
  );
}
