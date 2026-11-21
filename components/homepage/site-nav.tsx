"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './icon';

export const siteNavItems = [
  { label: 'How it works', href: '/how-it-works' },
  { label: 'Earn with your Agent', href: '/earn' },
  { label: 'Pricing', href: '/pricing' },
] as const;

/** The public site's header. It sits on the photo at the top of every marketing page. */
/**
 * Where a menu item goes. Signed in, /security is the workspace's own Security
 * area, so the public site's Security link opens the same public page instead
 * (/security-check): logged in or out, Security here is the public page.
 */
export function siteNavHref(href: string, signedIn: boolean): string {
  return signedIn && href === '/security' ? '/security-check' : href;
}

export function SiteNav({ signedIn = false }: { signedIn?: boolean }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const close = () => setMenuOpen(false);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('resize', close);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('resize', close); window.removeEventListener('keydown', escape); };
  }, []);

  return (
    <header className="th-nav">
      <Link className="th-brand" href="/" aria-label="Ziki home">
        <span className="th-mark"><Image src="/homepage/ziki-mark.svg" width={22} height={22} alt="" /></span>
        Ziki
      </Link>
      <nav id="homepage-navigation" className={menuOpen ? 'th-links open' : 'th-links'} aria-label="Main navigation">
        {siteNavItems.map((item) => (
          <Link
            href={siteNavHref(item.href, signedIn)}
            key={item.href}
            aria-current={pathname === siteNavHref(item.href, signedIn) || pathname?.startsWith(`${item.href}/`) ? 'page' : undefined}
            onClick={() => setMenuOpen(false)}
          >
            {item.label}
          </Link>
        ))}
        <Link className="th-btn th-btn-dark th-menu-cta" href={signedIn ? '/home' : '/signup'} onClick={() => setMenuOpen(false)}>{signedIn ? 'Open organisation' : 'Get started'}</Link>
      </nav>
      <div className="th-actions">
        {signedIn ? (
          <Link className="th-btn th-btn-dark th-desktop" href="/home">Open organisation</Link>
        ) : (
          <>
            <Link className="th-btn th-btn-light th-desktop" href="/login">Login</Link>
            <Link className="th-btn th-btn-dark th-desktop" href="/signup">Get started</Link>
          </>
        )}
        <button className="th-icon-btn th-menu-button" type="button" aria-controls="homepage-navigation" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
          <Icon name={menuOpen ? 'x' : 'menu'} size={18} />
        </button>
      </div>
    </header>
  );
}
