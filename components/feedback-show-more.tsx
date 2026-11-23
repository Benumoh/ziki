"use client";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
/** Reveal seven more of the current server-filtered results without leaving the page. */
export function FeedbackShowMore({ items }: { items: ReactNode[] }) {
  const [visible, setVisible] = useState(7);
  const id = useId();
  return <div className="bg-zk-chip p-3"><ul id={id} className="space-y-3">{items.slice(0, visible)}</ul>{visible < items.length ? <div className="mt-3 flex justify-center"><Button variant="secondary" aria-controls={id} onClick={() => setVisible(count => count + 7)}>Show more</Button></div> : null}</div>;
}
