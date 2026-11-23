/**
 * A website scan's Code scan page (18 Nov call: connect first, pay later), where its code scan is connected, paid for
 * and followed, under the same three steps as the website's other pages. A code scan's own pages send you here,
 * keeping `?fix` (a finding's "Fix it for me") and `?bought` (back from buying Ziks).
 */
export function codeScanPage(siteCheckId: string, query: { fix?: string | string[]; bought?: string } = {}): string {
  const params = new URLSearchParams();
  const fix = Array.isArray(query.fix) ? query.fix.join(",") : query.fix;
  if (fix) params.set("fix", fix);
  if (query.bought === "1") params.set("bought", "1");
  const rest = params.toString();
  return `/security/checks/${encodeURIComponent(siteCheckId)}/code${rest ? `?${rest}` : ""}`;
}
