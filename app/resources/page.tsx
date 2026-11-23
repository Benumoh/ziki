import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { auth } from '@/auth';
import { pageMetadata } from '@/lib/seo/site';
import { posts, resourceHref, formatPostDate, RESOURCES_HREF } from '@/lib/resources/posts';
import { Icon } from '@/components/homepage/icon';
import { SiteFooter } from '@/components/homepage/site-footer';
import { SiteNav } from '@/components/homepage/site-nav';
import '@/components/homepage/homepage.css';

export const metadata: Metadata = pageMetadata({
  title: 'Resources',
  description: 'Guides and articles on using AI agents to find, fix and check bugs in your app, and on how Ziki compares with other issue trackers.',
  path: RESOURCES_HREF,
});

/** Resources (#resources): every article, newest first, rendered on the server. */
export default async function ResourcesPage() {
  const session = await auth();
  const signedIn = Boolean(session?.user);
  return (
    <main className="ziki-homepage" id="top">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <section className="top-hero th-centered" id="main-content" tabIndex={-1}>
        <SiteNav signedIn={signedIn} />
        <div className="th-copy">
          <h1 className="th-title">Resources</h1>
          <p className="th-lede">Guides on putting AI agents to work on your app: finding bugs, fixing them, and checking every fix before it goes live.</p>
        </div>
        <div className="res-list">
          {posts.map((post) => (
            <Link className="res-card" href={resourceHref(post.slug)} key={post.slug}>
              <span className="res-meta">{formatPostDate(post.published)} · {post.readMinutes} min read</span>
              <h2>{post.title}</h2>
              <p>{post.description}</p>
              <span className="res-more">Read the article <Icon name="arrow" size={15} /></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="closing-cta">
        <div className="cta-mark"><Image src="/homepage/ziki-mark.svg" width={32} height={32} alt="" /></div>
        <h2>Try it on your app</h2>
        <p>Agents fix 5 things in your app every day, free.</p>
        <Link className="button button-large" href={signedIn ? '/home' : '/signup'}>{signedIn ? 'Open your organisation' : 'Start free'} <Icon name="arrow" size={17} /></Link>
      </section>

      <SiteFooter />
    </main>
  );
}
