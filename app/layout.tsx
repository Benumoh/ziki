import type { Metadata } from "next";
import localFont from "next/font/local";
import { ConsentBanner } from "@/components/consent-banner";
import { getSiteUrl } from "@/lib/site-url";
import { SHARE_IMAGE } from "@/lib/share-image";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { ToastProvider } from "@/components/ui/toast";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ThemePreference } from "@/components/theme-toggle";
import { THEME_COOKIE, parseTheme, themeAttribute, type Theme } from "@/lib/theme";
import "./globals.css";

// Fonts are self-hosted from app/fonts (latin, variable woff2) so the build
// never has to reach Google Fonts (#1431).

// Platform typeface from the redesign handoff. Mono stays Geist.
const manrope = localFont({
  src: "./fonts/manrope-latin.woff2",
  variable: "--font-manrope",
  weight: "400 800",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
});

// The signed-in app's typeface (globals.css switches to it under the app
// shell). Loaded here so dialogs and toasts, which render on <body>, get it too.
const inter = localFont({
  src: "./fonts/inter-latin.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: "Ziki",
    template: "%s · Ziki",
  },
  description: "Ziki issue tracking interface — HNG15 mini-project",
  alternates: {
    types: {
      "text/plain": [{ url: "/llms.txt", title: "LLM Integration Documentation" }],
    },
  },
  openGraph: {
    siteName: "Ziki",
    type: "website",
    images: [{ ...SHARE_IMAGE }],
  },
  twitter: {
    card: "summary_large_image",
    images: [SHARE_IMAGE.url],
  },
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
  return (
    <html lang="en" data-theme={themeAttribute(theme)} className="overflow-x-clip" suppressHydrationWarning>
      <head>
        <link rel="alternate" type="text/plain" href="/llms.txt" title="LLM Integration Documentation" />
      </head>
      <body
        className={`${manrope.variable} ${geistMono.variable} ${inter.variable} min-h-screen overflow-x-clip antialiased`}
      >
        {/*
          Both live at the root rather than in (app) so every route — including
          sign-in and the password-reset pages — can confirm and announce.
          ThemePreference is the same choice written onto <html>, so the
          toggle's first paint matches the server HTML.
        */}
        <ThemePreference theme={theme}>
          <ToastProvider>
            <ConfirmProvider>{children}</ConfirmProvider>
          </ToastProvider>
        </ThemePreference>
        {/* The cookie banner, and Google Tag Manager (GTM-5TNDKX33) behind it: it loads only once a visitor accepts. */}
        <ConsentBanner />
      </body>
    </html>
  );
}
