import { cache } from 'react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { auth } from '@/auth';
import { Icon } from '@/components/homepage/icon';
import { SiteFooter } from '@/components/homepage/site-footer';
import { SiteNav } from '@/components/homepage/site-nav';
import { JsonLd } from '@/components/json-ld';
import { ComparisonCard } from '@/components/compare/comparison-card';
import { PlatformBadge } from '@/components/compare/platform-badge';
import { StatusPill } from '@/components/compare/status-pill';
import '@/components/homepage/homepage.css';
import '@/components/compare/compare.css';
import { buildComparison, type BuiltComparison, type PlatformData } from '@/lib/compare/build';
import { categoryShortLabel, FEATURE_STATUSES } from '@/lib/compare/catalog';
import { findCurated, findPublishedPlatform, listComparisonCards, relatedCards } from '@/lib/compare/data';
import { formatDate, verifiedText } from '@/lib/compare/format';
import { comparisonJsonLd, comparisonMetadata } from '@/lib/compare/seo';
import { canonicalPair, comparisonHref, comparisonSlug, parseComparisonSlug } from '@/lib/compare/slug';

type Loaded = { a: PlatformData; b: PlatformData; built: BuiltComparison; redirectTo: string | null };

/** Loads and builds the pair once per request, for the page and its metadata. */
const load = cache(async (rawSlug: string): Promise<Loaded | null> => {
  const parsed = parseComparisonSlug(rawSlug);
  if (!parsed) return null;
  const [first, second] = await Promise.all([findPublishedPlatform(parsed.a), findPublishedPlatform(parsed.b)]);
  if (!first || !second) return null;
  const pair = canonicalPair(first.slug, second.slug);
  const [a, b] = pair.a === first.slug ? [first, second] : [second, first];
  const curated = await findCurated(a.id, b.id);
  const wanted = comparisonSlug(pair.a, pair.b);
  let decoded = rawSlug;
  try { decoded = decodeURIComponent(rawSlug); } catch { /* parseComparisonSlug already refused it */ }
  return { a, b, built: buildComparison(a, b, curated), redirectTo: decoded === wanted ? null : comparisonHref(pair.a, pair.b) };
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const loaded = await load((await params).slug);
  if (!loaded) return { title: 'Comparison not found', robots: { index: false, follow: false } };
  return comparisonMetadata(loaded.built, loaded.a, loaded.b);
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="cmp-unknown">{empty}</p>;
  return <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

/** One comparison (#compare), built like the directory: a centred hero with the two platforms, then the sections. */
export default async function ComparisonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const loaded = await load(slug);
  if (!loaded) notFound();
  if (loaded.redirectTo) permanentRedirect(loaded.redirectTo);
  const { a, b, built } = loaded;

  const [session, cards] = await Promise.all([auth(), listComparisonCards()]);
  const signedIn = Boolean(session?.user);
  const related = relatedCards(cards, built.slug, a, b);
  const rival = a.isZiki ? b : b.isZiki ? a : null;
  const visit = rival ? [rival] : [a, b];
  const sources = [...new Set([...a.sourceUrls, ...b.sourceUrls])];
  const picks = {
    a: built.recommendations.filter((r) => r.pick === 'a'),
    b: built.recommendations.filter((r) => r.pick === 'b'),
    either: built.recommendations.filter((r) => r.pick === 'either'),
  };
  const sideClass = (p: PlatformData) => (p.isZiki ? 'is-ziki' : undefined);

  return (
    <main className="ziki-homepage cmp-page" id="top">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <JsonLd data={comparisonJsonLd(built, a, b)} />

      <section className="top-hero th-centered" id="main-content" tabIndex={-1}>
        <SiteNav signedIn={signedIn} />
        <div className="th-copy">
          <Link className="cmp-back" href="/compare">
            <Icon name="arrow" size={14} /> All comparisons
          </Link>
          <div className="cmp-hero-pair" aria-hidden="true">
            <PlatformBadge name={a.name} logoUrl={a.logoUrl} isZiki={a.isZiki} size={56} />
            <span className="cmp-hero-vs">vs</span>
            <PlatformBadge name={b.name} logoUrl={b.logoUrl} isZiki={b.isZiki} size={56} />
          </div>
          <h1 className="th-title">{a.name} <span className="th-accent">vs {b.name}</span></h1>
          <p className="th-lede">{built.summary}</p>
          <div className="th-cta-row">
            <a className="th-btn th-btn-lg th-btn-primary" href="#table">See the comparison</a>
            {visit.map((p) => (
              <a key={p.id} className="th-btn th-btn-lg th-btn-soft" href={p.websiteUrl} target="_blank" rel="noopener noreferrer">Visit {p.name} website</a>
            ))}
          </div>
          <p className="cmp-meta">
            <span>{a.name}: {verifiedText(a.lastVerifiedAt)}</span>
            <span>{b.name}: {verifiedText(b.lastVerifiedAt)}</span>
            <span>Page updated {formatDate(built.updatedAt)}</span>
          </p>
        </div>

        <section className="cmp-hero-builder cmp-hero-intro" aria-labelledby="intro-title">
          <h2 className="sr-only" id="intro-title">The two platforms</h2>
          <div className="cmp-intro">
            {[a, b].map((p) => (
              <div key={p.id} className={sideClass(p)}>
                <div className="cmp-intro-name">
                  <PlatformBadge name={p.name} logoUrl={p.logoUrl} isZiki={p.isZiki} size={36} />
                  <div>
                    <h3>{p.name}</h3>
                    <span>{categoryShortLabel(p.category)}</span>
                  </div>
                </div>
                <p>{p.description}</p>
              </div>
            ))}
          </div>
          <p className="cmp-note">{built.relationshipNote}</p>
          {built.customIntro ? <p className="cmp-note">{built.customIntro}</p> : null}
        </section>
      </section>

      <section className="cmp-section" id="table" aria-labelledby="table-title">
        <div className="cmp-section-head">
          <span className="cmp-eyebrow">At a glance</span>
          <h2 id="table-title">Quick comparison</h2>
          <p>
            {built.rows.length} capabilities that apply to both. Verified answers: {a.name} {built.verifiedA} of {built.rows.length}, {b.name} {built.verifiedB} of {built.rows.length}.
            “Not verified” means nobody has checked it against the vendor’s own documentation, not that it is missing.
          </p>
        </div>
        <div className="cmp-table-wrap">
          <table className="cmp-table">
            <caption className="sr-only">{a.name} and {b.name} compared by capability</caption>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col" className={sideClass(a)}>{a.name}</th>
                <th scope="col" className={sideClass(b)}>{b.name}</th>
              </tr>
            </thead>
            <tbody>
              {built.rows.map((row) => (
                <tr key={row.dimension.key}>
                  <th scope="row">{row.dimension.label}<small>{row.dimension.question}</small></th>
                  {([['a', a], ['b', b]] as const).map(([side, p]) => {
                    const entry = row[side];
                    return (
                      <td key={side} className={sideClass(p)} data-label={p.name}>
                        <StatusPill status={entry.status} />
                        {entry.note ? <span className="cmp-cell-note">{entry.note}{entry.sourceUrl ? <> <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">Source</a></> : null}</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cmp-legend">
          {FEATURE_STATUSES.map((s) => <StatusPill key={s.value} status={s.value} />)}
        </p>
      </section>

      <section className="cmp-section" aria-labelledby="detail-title">
        <div className="cmp-section-head">
          <span className="cmp-eyebrow">Side by side</span>
          <h2 id="detail-title">Detailed comparison</h2>
        </div>
        {built.details.length > 0 ? (
          <div className="cmp-details">
            {built.details.map((detail) => (
              <div className="cmp-detail" key={detail.heading}>
                <h3>{detail.heading}</h3>
                <p className={sideClass(a)}><b>{a.name}</b>{detail.a}</p>
                <p className={sideClass(b)}><b>{b.name}</b>{detail.b}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="cmp-empty">No detailed notes are recorded for this pair yet. See each vendor’s own site for specifics.</p>
        )}
      </section>

      <section className="cmp-section" aria-labelledby="sl-title">
        <div className="cmp-section-head">
          <span className="cmp-eyebrow">Trade-offs</span>
          <h2 id="sl-title">Strengths and limitations</h2>
        </div>
        <div className="cmp-two">
          {([[a, built.strengthsA, built.limitationsA], [b, built.strengthsB, built.limitationsB]] as const).map(([p, strengths, limitations]) => (
            <div key={p.id} className={`cmp-panel ${p.isZiki ? 'is-ziki' : ''}`}>
              <h3><PlatformBadge name={p.name} logoUrl={p.logoUrl} isZiki={p.isZiki} size={32} />{p.name}</h3>
              <h4><Icon name="check" size={14} /> Strengths</h4>
              <List items={strengths} empty="Not verified yet. Check the vendor’s own documentation." />
              <h4><Icon name="x" size={14} /> Limitations</h4>
              <List items={limitations} empty="Not verified yet. No limitation is assumed." />
            </div>
          ))}
        </div>
      </section>

      <section className="cmp-section" aria-labelledby="choose-title">
        <div className="cmp-section-head">
          <span className="cmp-eyebrow">Decide</span>
          <h2 id="choose-title">Which platform should you choose?</h2>
        </div>
        {built.recommendations.length > 0 ? (
          <div className="cmp-choose">
            {([[`Choose ${a.name} if you want…`, picks.a], [`Choose ${b.name} if you want…`, picks.b], ['Either can work for…', picks.either]] as const)
              .filter(([, items]) => items.length > 0)
              .map(([heading, items]) => (
                <div className="cmp-panel" key={heading}>
                  <h3>{heading}</h3>
                  <ul>{items.map((item) => <li key={item.useCase}>{item.useCase}{item.note ? <span>{item.note}</span> : null}</li>)}</ul>
                </div>
              ))}
          </div>
        ) : (
          <p className="cmp-empty">No recommendation is recorded for this pair yet.</p>
        )}
        {sources.length > 0 ? (
          <p className="cmp-sources">
            Sources: {sources.map((url, i) => <span key={url}>{i > 0 ? ', ' : ''}<a href={url} target="_blank" rel="noopener noreferrer">{url.replace(/^https?:\/\//, '')}</a></span>)}
          </p>
        ) : null}
      </section>

      {related.length > 0 ? (
        <section className="cmp-section" aria-labelledby="related-title">
          <div className="cmp-section-head">
            <span className="cmp-eyebrow">Keep comparing</span>
            <h2 id="related-title">Related comparisons</h2>
          </div>
          <div className="cmp-grid">{related.map((card) => <ComparisonCard key={card.slug} card={card} />)}</div>
          <div className="cmp-more"><Link className="th-btn th-btn-lg th-btn-soft" href="/compare#all">View all comparisons</Link></div>
        </section>
      ) : null}

      <section className="closing-cta cmp-closing" aria-labelledby="cta-title">
        <div className="cta-mark"><Image src="/homepage/ziki-mark.svg" width={32} height={32} alt="" /></div>
        <h2 id="cta-title">{rival ? `Ready to try Ziki, or see ${rival.name} first?` : 'Look closer'}</h2>
        <p>Add your app and watch agents find, fix and check the work. Your first 5 fixes are free.</p>
        <div className="cta-pair">
          <Link className="button button-large" href={signedIn ? '/home' : '/signup'}>
            {signedIn ? 'Open your workspace' : 'Get started'} <Icon name="arrow" size={17} />
          </Link>
          <Link className="button button-large button-secondary" href="/">Explore Ziki</Link>
          {visit.map((p) => (
            <a key={p.id} className="button button-large button-secondary" href={p.websiteUrl} target="_blank" rel="noopener noreferrer">Visit {p.name} website</a>
          ))}
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
