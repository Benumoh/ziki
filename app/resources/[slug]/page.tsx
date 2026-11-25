import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { JsonLd } from '@/components/json-ld';
import { pageMetadata, SITE_NAME } from '@/lib/seo/site';
import { absoluteUrl } from '@/lib/site-url';
import { findPost, formatPostDate, posts, resourceHref, RESOURCES_HREF } from '@/lib/resources/posts';
import { Icon } from '@/components/homepage/icon';
import { ResourceCard } from '@/components/resources/resource-card';
import { SiteFooter } from '@/components/homepage/site-footer';
import { SiteNav } from '@/components/homepage/site-nav';
import '@/components/homepage/homepage.css';

type Params = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return posts.map((post) => ({ slug: post.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const post = findPost((await params).slug);
  if (!post) return {};
  return pageMetadata({ title: post.title, description: post.description, path: resourceHref(post.slug), type: 'article' });
}

/** One article on /resources (#resources), rendered on the server with its full text. */
export default async function ResourcePostPage({ params }: Params) {
  const post = findPost((await params).slug);
  if (!post) notFound();
  const session = await auth();
  const signedIn = Boolean(session?.user);
  const startHref = signedIn ? '/home' : '/signup';
  const others = posts.filter((other) => other.slug !== post.slug).slice(0, 2);
  const url = absoluteUrl(resourceHref(post.slug));

  return (
    <main className="ziki-homepage" id="top">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: post.title,
          description: post.description,
          datePublished: post.published,
          dateModified: post.published,
          mainEntityOfPage: url,
          url,
          author: { '@type': 'Organization', name: SITE_NAME, url: absoluteUrl('/') },
          publisher: { '@type': 'Organization', name: SITE_NAME, url: absoluteUrl('/') },
        }}
      />
      <a className="skip-link" href="#main-content">Skip to content</a>
      <section className="top-hero th-centered">
        <SiteNav signedIn={signedIn} />
        <article className="res-article" id="main-content" tabIndex={-1}>
          <header className="res-head">
            <nav aria-label="Breadcrumb"><Link className="res-back" href={RESOURCES_HREF}><Icon name="arrow" size={14} /> All resources</Link></nav>
            <h1>{post.title}</h1>
            <p className="res-meta">{formatPostDate(post.published)} · {post.readMinutes} min read</p>
          </header>
          <div className="res-body">{post.body}</div>
          <aside className="res-cta">
            <h2>Put agents to work on your app</h2>
            <p>Free every day: 5 fixes and 5 marketing items. No card needed.</p>
            <Link className="th-btn th-btn-primary th-btn-lg" href={startHref}>{signedIn ? 'Open your organisation' : 'Start free'}</Link>
          </aside>
        </article>
      </section>

      {others.length > 0 ? (
        <section className="home-explainer res-related" aria-labelledby="res-related-title">
          <div className="hx-inner">
            <div className="hx-intro">
              <span className="hx-kicker">Keep reading</span>
              <h2 id="res-related-title">More from Resources</h2>
            </div>
            <div className="res-list">
              {others.map((other) => <ResourceCard post={other} key={other.slug} />)}
            </div>
            <div className="res-all-link">
              <Link className="button button-large button-secondary" href={RESOURCES_HREF}>View all resources <Icon name="arrow" size={16} /></Link>
            </div>
          </div>
        </section>
      ) : null}

      <section className="closing-cta">
        <div className="cta-mark"><Image src="/homepage/ziki-mark.svg" width={32} height={32} alt="" /></div>
        <h2>Your first 5 fixes are free</h2>
        <p>Add your app today and see what agents fix by tonight.</p>
        <Link className="button button-large" href={startHref}>Start free <Icon name="arrow" size={17} /></Link>
      </section>

      <SiteFooter />
    </main>
  );
}
