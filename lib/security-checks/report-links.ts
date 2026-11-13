/**
 * Chloe's "Unlock fixes" page (12 Nov plan, C1) with these findings chosen:
 * `/security/checks/{id}/pay?results=id1,id2`. The report's tick boxes and
 * its "Unlock all" both link here.
 */
export function unlockHref(checkId: string, resultIds: readonly string[]): string {
  return `/security/checks/${encodeURIComponent(checkId)}/pay?results=${resultIds.map(encodeURIComponent).join(",")}`;
}
