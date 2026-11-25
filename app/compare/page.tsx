import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { auth } from '@/auth';
import { Icon } from '@/components/homepage/icon';
import { SiteFooter } from '@/components/homepage/site-footer';
import { SiteNav } from '@/components/homepage/site-nav';
import { JsonLd } from '@/components/json-ld';
import { CompareBuilder, type PlatformOption } from '@/components/compare/compare-builder';
import { ComparisonCard as Card } from '@/components/compare/comparison-card';
import '@/components/homepage/homepage.css';
import '@/components/compare/compare.css';
import { COMPARE_CATEGORIES, COMPARE_DIMENSIONS, featureOf, isCompareCategory } from '@/lib/compare/catalog';
import { listComparisonCards, listPublishedPlatforms, type ComparisonCard } from '@/lib/compare/data';
import { directoryJsonLd, directoryMetadata } from '@/lib/compare/seo';

export const metadata: Metadata = directoryMetadata();

/** The comparison directory (#compare), built like Pricing and How it works: a centred hero holding the picker, then the lists. */
export default async function CompareDirectoryPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const [session, query] = await Promise.all([auth(), searchParams]);
  const signedIn = Boolean(session?.user);
  const startHref = signedIn ? '/home' : '/signup';
  const category = query.category && isCompareCategory(query.category) ? query.category : null;

  const [platforms, cards] = await Promise.all([listPublishedPlatforms(), listComparisonCards()]);
  const options: PlatformOption[] = platforms.map((p) => ({ slug: p.slug, name: p.name, category: p.category, logoUrl: p.logoUrl, isZiki: p.isZiki }));
  const ziki = platforms.find((p) => p.isZiki) ?? null;

  const popular = cards.filter((c) => c.popular).slice(0, 8);
  const inCategory = (card: ComparisonCard) => !category || card.a.category === category || card.b.category === category;
  const listed = cards.filter(inCategory).sort((x, y) => x.title.localeCompare(y.title));
  const countFor = (value: string) => cards.filter((c) => c.a.category === value || c.b.category === value).length;
  const categoryName = category ? COMPARE_CATEGORIES.find((c) => c.value === category)?.label : null;
  const why = ziki
    ? COMPARE_DIMENSIONS.map((dimension) => ({ dimension, entry: featureOf(ziki.features, dimension.key) })).filter(
        ({ entry }) => (entry.status === 'available' || entry.status === 'partial') && entry.note,
      )
    : [];

  return (
    <main className="ziki-homepage cmp-page" id="top">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <JsonLd data={directoryJsonLd(cards.length)} />

      <section className="top-hero th-centered" id="main-content" tabIndex={-1}>
        <SiteNav signedIn={signedIn} />
        <div className="th-copy">
          <span className="cmp-eyebrow">Compare</span>
          <h1 className="th-title">Ziki vs the rest. <br /><span className="th-accent">Find the right AI platform.</span></h1>
          <p className="th-lede">Explore how Ziki compares with other AI platforms, agent builders and automation tools. Compare features, capabilities, workflows and use cases to make an informed decision.</p>
        </div>
        <section className="cmp-hero-builder" id="builder" aria-labelledby="builder-title">
          <div className="cmp-builder-head">
            <h2 id="builder-title">Pick two platforms</h2>
            <p>Search the catalogue, filter by type, and open a side-by-side comparison. Ziki can be either side.</p>
          </div>
          <CompareBuilder options={options} />
        </section>
        <p className="cmp-builder-foot">Or <a href="#all">browse all {cards.length} comparisons</a></p>
      </section>

      <section className="cmp-section" id="popular" aria-labelledby="popular-title">
        <div className="cmp-section-head">
          <span className="cmp-eyebrow">Most read</span>
          <h2 id="popular-title">Popular comparisons</h2>
        </div>
        {popular.length > 0 ? (
          <div className="cmp-grid">{popular.map((card) => <Card key={card.slug} card={card} />)}</div>
        ) : (
          <p className="cmp-empty">No popular comparisons are featured yet.</p>
        )}
        <div className="cmp-more"><a className="th-btn th-btn-lg th-btn-soft" href="#all">View all comparisons</a></div>
      </section>

      <section className="cmp-section" id="all" aria-labelledby="all-title">
        <div className="cmp-section-head">
          <span className="cmp-eyebrow">Browse by category</span>
          <h2 id="all-title">{categoryName ? `${categoryName} comparisons` : 'All comparisons'}</h2>
          <p>Platforms aren’t all rivals. Each category groups products that solve the same kind of problem.</p>
        </div>
        <nav className="cmp-categories" id="categories" aria-label="Comparison categories">
          <Link className="cmp-category" href="/compare#all" aria-current={category ? undefined : 'true'}>
            All <span>{cards.length}</span>
          </Link>
          {COMPARE_CATEGORIES.map((c) => (
            <Link key={c.value} className="cmp-category" href={`/compare?category=${c.value}#all`} aria-current={category === c.value ? 'true' : undefined}>
              {c.label} <span>{countFor(c.value)}<span className="sr-only"> comparisons</span></span>
            </Link>
          ))}
        </nav>
        {listed.length > 0 ? (
          <div className="cmp-grid">{listed.map((card) => <Card key={card.slug} card={card} />)}</div>
        ) : (
          <p className="cmp-empty">Nothing in this category yet. Platforms are added as they’re verified.</p>
        )}
      </section>

      <section className="home-explainer cmp-why-band" id="why" aria-labelledby="why-title">
        <div className="hx-inner">
          <div className="hx-intro">
            <span className="hx-kicker">What Ziki does</span>
            <h2 id="why-title">Why compare Ziki?</h2>
            <p>What Ziki does, as documented on this site and in its product. Where something isn’t verified, a comparison says so instead of guessing.</p>
          </div>
          {why.length > 0 ? (
            <div className="hx-facts cmp-why">
              {why.map(({ dimension, entry }) => (
                <div className="hx-fact" key={dimension.key}>
                  <h3>{dimension.label}</h3>
                  <p>{entry?.note}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="cmp-empty">Ziki’s capabilities will appear here once the catalogue is loaded.</p>
          )}
        </div>
      </section>

      <section className="closing-cta" aria-labelledby="cmp-end">
        <div className="cta-mark"><Image src="/homepage/ziki-mark.svg" width={32} height={32} alt="" /></div>
        <h2 id="cmp-end">See it on your own app</h2>
        <p>Add your app and watch agents find, fix and check the work. Your first 5 fixes are free.</p>
        <Link className="button button-large" href={startHref}>Start free <Icon name="arrow" size={17} /></Link>
      </section>

      <SiteFooter />
    </main>
  );
}
