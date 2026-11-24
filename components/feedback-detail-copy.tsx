"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
export function FeedbackDetailCopy({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return <Button variant="secondary" onClick={async () => { setCopied(await copyText(new URL(path, window.location.origin).href)); }}>{copied ? "Link copied" : "Copy tracking link"}</Button>;
}
