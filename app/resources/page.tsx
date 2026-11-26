import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { auth } from '@/auth';
import { pageMetadata } from '@/lib/seo/site';
import { posts, RESOURCES_HREF } from '@/lib/resources/posts';
import { Icon } from '@/components/homepage/icon';
import { ResourceCard } from '@/components/resources/resource-card';
import { SiteFooter } from '@/components/homepage/site-footer';
import { SiteNav } from '@/components/homepage/site-nav';
import '@/components/homepage/homepage.css';

export const metadata: Metadata = pageMetadata({
  title: 'Resources',
  description: 'Guides and articles on using AI agents to find, fix and check bugs in your app, and on how Ziki compares with other issue trackers.',
  path: RESOURCES_HREF,
});

/** Resources (#resources): the newest article first, then every article, rendered on the server. */
export default async function ResourcesPage() {
  const session = await auth();
  const signedIn = Boolean(session?.user);
  const [latest] = posts;
  return (
    <main className="ziki-homepage res-page" id="top">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <section className="top-hero th-centered" id="main-content" tabIndex={-1}>
        <SiteNav signedIn={signedIn} />
        <div className="th-copy">
          <span className="hx-kicker res-kicker">Resources</span>
          <h1 className="th-title">Guides for putting <br />AI agents <span className="th-accent">to work</span></h1>
          <p className="th-lede">Finding bugs in your app, fixing them, and checking every fix before it goes live.</p>
        </div>
        {latest ? <div className="res-featured"><ResourceCard post={latest} featured /></div> : null}
      </section>

      <section className="home-explainer" aria-labelledby="res-all-title">
        <div className="hx-inner">
          <div className="hx-intro">
            <span className="hx-kicker">All articles</span>
            <h2 id="res-all-title">Every guide, newest first</h2>
            <p>{posts.length} {posts.length === 1 ? 'article' : 'articles'} on agents, issue tracking and shipping fixes you can trust.</p>
          </div>
          <div className="res-list">
            {posts.map((post) => <ResourceCard post={post} key={post.slug} />)}
          </div>
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
