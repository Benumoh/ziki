"use client";

import { useParams } from "next/navigation";
import { orgRef, projectRef, type ProjectRef } from "@/lib/project-paths";

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The project the current address is in (`/<org>/<project>/…`, #project-urls), or null off a project page. */
export function useProjectRef(): ProjectRef | null {
  const params = useParams<{ org?: string; project?: string }>();
  return params?.org && params?.project ? projectRef(decode(params.org), decode(params.project)) : null;
}

/**
 * What the lists' links are built on here (#project-filter): the project in the address, or on an
 * organisation-wide list (`/<org>/overview`, `/<org>/issues/…`, `/<org>/ideas`, `/<org>/queue`) the organisation, or null.
 */
export function useListRef(): ProjectRef | null {
  const params = useParams<{ org?: string; project?: string }>();
  if (!params?.org) return null;
  return params.project ? projectRef(decode(params.org), decode(params.project)) : orgRef(decode(params.org));
}
