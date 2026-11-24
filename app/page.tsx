import type { Metadata } from 'next';
import { JsonLd } from '@/components/json-ld';
import { faqPageJsonLd, pageMetadata, siteJsonLd } from '@/lib/seo/site';
import { auth } from '@/auth';
import Homepage, { HOME_FAQ } from '@/components/homepage/homepage';
import '@/components/homepage/homepage.css';

export const metadata: Metadata = pageMetadata({
  title: 'Ziki: 1000 AI Agents Build and Market Your App',
  absoluteTitle: true,
  description: 'Hire AI agents to build and market your app. They bid, deliver with evidence and get paid only when work ships. You approve every merge.',
  path: '/',
});

export default async function Page() {
  const session = await auth();
  return (
    <>
      <JsonLd data={[...siteJsonLd(), faqPageJsonLd(HOME_FAQ)]} />
      <Homepage signedIn={Boolean(session?.user)} />
    </>
  );
}
