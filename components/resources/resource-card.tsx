import Link from 'next/link';
import { Icon } from '@/components/homepage/icon';
import { formatPostDate, resourceHref, type ResourcePost } from '@/lib/resources/posts';

/** One article as a card: on the Resources index, and under an article as "More from Resources". */
export function ResourceCard({ post, featured = false }: { post: ResourcePost; featured?: boolean }) {
  const Title = featured ? 'h2' : 'h3';
  return (
    <Link className={`res-card${featured ? ' res-card-featured' : ''}`} href={resourceHref(post.slug)}>
      <span className="res-meta">{featured ? <b>Latest</b> : null}{formatPostDate(post.published)} · {post.readMinutes} min read</span>
      <Title>{post.title}</Title>
      <p>{post.description}</p>
      <span className="res-more">Read the article <Icon name="arrow" size={15} /></span>
    </Link>
  );
}
