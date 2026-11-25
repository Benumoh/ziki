import Link from 'next/link';
import { Icon } from '@/components/homepage/icon';
import { PlatformBadge } from '@/components/compare/platform-badge';
import type { ComparisonCard as Card } from '@/lib/compare/data';
import { comparisonHref } from '@/lib/compare/slug';

/** One comparison in a grid: the two logos, its title and summary, and a link to the page. */
export function ComparisonCard({ card }: { card: Card }) {
  return (
    <article className="cmp-card">
      <div className="cmp-card-logos">
        <PlatformBadge name={card.a.name} logoUrl={card.a.logoUrl} isZiki={card.a.isZiki} size={32} />
        <span aria-hidden="true">vs</span>
        <PlatformBadge name={card.b.name} logoUrl={card.b.logoUrl} isZiki={card.b.isZiki} size={32} />
      </div>
      <h3>{card.title}</h3>
      <p>{card.description}</p>
      <Link className="cmp-link" href={comparisonHref(card.a.slug, card.b.slug)}>
        View comparison<span className="sr-only">: {card.title}</span> <Icon name="arrow" size={14} />
      </Link>
    </article>
  );
}
