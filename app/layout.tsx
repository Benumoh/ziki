import type { Metadata } from "next";
import { DEFAULT_OG_IMAGES, SITE_DESCRIPTION, SITE_NAME, SITE_OG, siteVerification, TITLE_TEMPLATE } from "@/lib/seo/site";
import localFont from "next/font/local";
import { ConsentBanner } from "@/components/consent-banner";
import { getSiteUrl } from "@/lib/site-url";
import { SHARE_IMAGE } from "@/lib/share-image";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { ToastProvider } from "@/components/ui/toast";
import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ThemePreference } from "@/components/theme-toggle";
import { ExternalPageTheme } from "@/components/external-page-theme";
import { isExternalPage } from "@/lib/external-pages";
import { THEME_COOKIE, parseTheme, themeAttribute, type Theme } from "@/lib/theme";
import "./globals.css";

// Fonts are self-hosted from app/fonts (latin, variable woff2) so the build
// never has to reach Google Fonts (#1431).

// One primary typeface on every surface (#874). Mono stays Geist for code.
const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
});

// The app's typeface: Geist, quiet and even at small sizes. Loaded here so dialogs and toasts, which render on
// <body>, get it too. Inter stays for the public homepage (components/homepage).
const geist = localFont({
  src: "./fonts/geist-latin.woff2",
  variable: "--font-geist",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  // Every page gives only its own title; the site name follows it once (#seo-pages).
  title: {
    default: SITE_NAME,
    template: TITLE_TEMPLATE,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: {
    types: {
      "text/plain": [{ url: "/llms.txt", title: "LLM Integration Documentation" }],
    },
  },
  openGraph: {
    ...SITE_OG,
    type: "website",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: DEFAULT_OG_IMAGES,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [SHARE_IMAGE.url],
  },
  formatDetection: { telephone: false, email: false, address: false },
  // #855: Search Console and Bing Webmaster verification, when their codes are set.
  verification: siteVerification(),
};

/**
 * #277, #659: the signed-in user's choice (so it follows them across devices),
 * else this device's last choice, else the device's own setting. Rendered
 * on <html> by the server, so the first paint is already right.
 */
async function currentTheme(): Promise<Theme> {
  const fromCookie = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  try {
    const session = await auth();
    const id = session?.user?.id;
    if (!id) return fromCookie;
    const user = await prisma.user.findUnique({ where: { id }, select: { theme: true } });
    return parseTheme(user?.theme ?? fromCookie);
  } catch {
    return fromCookie;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const theme = await currentTheme();
  // The public pages are always light (#external-pages-light); middleware passes the path in x-ziki-path.
  const external = isExternalPage((await headers()).get("x-ziki-path"));
  return (
    <html lang="en" data-theme={external ? "light" : themeAttribute(theme)} className="overflow-x-clip" suppressHydrationWarning>
      <head>
        <link rel="alternate" type="text/plain" href="/llms.txt" title="LLM Integration Documentation" />
      </head>
      <body
        className={`${geistMono.variable} ${geist.variable} min-h-screen overflow-x-clip antialiased`}
      >
        {/*
          Both live at the root rather than in (app) so every route — including
          sign-in and the password-reset pages — can confirm and announce.
          ThemePreference is the same choice written onto <html>, so the
          toggle's first paint matches the server HTML.
        */}
        <ThemePreference theme={theme}>
          <ExternalPageTheme />
          <ToastProvider>
            <ConfirmProvider>
              {children}
            </ConfirmProvider>
          </ToastProvider>
        </ThemePreference>
        {/* The cookie banner, and Google Tag Manager (GTM-5TNDKX33) behind it: it loads only once a visitor accepts. */}
        <ConsentBanner />
      </body>
    </html>
  );
}
