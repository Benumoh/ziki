import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";
import packageJson from "./package.json";
import { BASE_PATH } from "./lib/base-path";

function resolveBuildVersion(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_VERSION?.trim() || process.env.APP_VERSION?.trim();
  if (explicit) return explicit;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(packageJson.version);
  if (!match) return packageJson.version;
  try {
    const count = Number.parseInt(
      execFileSync("git", ["rev-list", "--count", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
      10,
    );
    if (Number.isInteger(count) && count > 0) {
      const basePatch = Number.parseInt(match[3] ?? "0", 10);
      return `${match[1]}.${match[2]}.${Math.max(basePatch, count)}`;
    }
  } catch {
    // Docker builds without .git fall back to package.json version (+ SOURCE_COMMIT at runtime).
  }
  return packageJson.version;
}

const nextConfig: NextConfig = {
  // #585: the production image ships only the traced standalone server.
  output: "standalone",
  // CI type-checks every commit (`tsc --noEmit`) before it can deploy, so the
  // image build and the end-to-end job set SKIP_BUILD_TYPECHECK=1 to skip
  // next build's second, identical check. Every other build still runs it.
  typescript: { ignoreBuildErrors: process.env.SKIP_BUILD_TYPECHECK === "1" },
  ...(BASE_PATH ? { basePath: BASE_PATH } : {}),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: resolveBuildVersion(),
    NEXTAUTH_URL:
      process.env.NEXTAUTH_URL ||
      (BASE_PATH
        ? `https://contributors.zedu.chat${BASE_PATH}/api/auth`
        : "https://ziki.dev/api/auth"),
  },
  outputFileTracingIncludes: {
    "/llms.txt": ["./docs/llms/**"],
    "/llms/[topic]": ["./docs/llms/**"],
    "/llms-full.txt": ["./docs/llms/**"],
    // The security report PDF embeds its own font (components/security-checks/report-pdf.tsx).
    // pdfkit loads its built-in font files (Helvetica.cjs and the like) by a path the tracer can't follow, so
    // the production image left them out and every download failed with "Cannot find module .../standard-fonts/Helvetica.cjs".
    "/security/checks/[id]/report.pdf": ["./assets/fonts/**", "./node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/**"],
  },
  async headers() {
    // #222: the app previously sent no security headers at all, which left
    // every page (including /login) framable by any origin and clickable-over.
    //
    // Note on scope: we deliberately do NOT set `default-src` / `script-src`.
    // Next.js injects inline flight-data scripts (`self.__next_f.push(...)`) that
    // would be blocked without a per-request nonce, which in turn requires
    // dynamic rendering. The directives below close the framing hole and the
    // cheap wins without that trade-off. Tightening script-src is worth a
    // follow-up once nonce plumbing exists.
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Accept-CH",
        value: "Sec-CH-UA-Platform-Version, Sec-CH-UA-Model",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(self), geolocation=(), interest-cohort=()",
      },
      {
        key: "Content-Security-Policy",
        value: [
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "object-src 'none'",
          "form-action 'self' https://github.com",
        ].join("; "),
      },
    ];

    // HSTS is meaningless over plain http and, for http://localhost, actively
    // unhelpful (browsers may upgrade and break local dev). Only send it when
    // we know we are building for a TLS deployment.
    if (process.env.NODE_ENV === "production") {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains",
      });
    }

    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    const list = [
      // Ziki Earn folded into Ziki (#earnings): your money is on /earnings, and the projects to earn on are
      // on Discover. Old /earn/... links and bookmarks keep working.
      { source: "/earn/earnings", destination: "/earnings", permanent: false },
      { source: "/earn/withdraw", destination: "/earnings", permanent: false },
      { source: "/withdraw", destination: "/earnings", permanent: false },
      { source: "/earn/:path+", destination: "/discover?open=true", permanent: false },
      {
        source: "/bugs",
        destination: "/issues",
        permanent: true,
      },
      {
        source: "/bugs/:path*",
        destination: "/issues/:path*",
        permanent: true,
      },
      {
        source: "/questions",
        destination: "/escalations",
        permanent: true,
      },
      {
        source: "/questions/:path*",
        destination: "/escalations/:path*",
        permanent: true,
      },
      {
        source: "/api/bugs/:path*",
        destination: "/api/issues/:path*",
        permanent: true,
      },
    ];
    if (!BASE_PATH) {
      return [
        {
          source: "/:path*",
          has: [
            {
              type: "host",
              value: "www.ziki.dev",
            },
          ],
          destination: "https://ziki.dev/:path*",
          permanent: true,
        },
        ...list,
        {
          source: "/bug-tracker",
          destination: "/",
          permanent: true,
        },
        {
          source: "/bug-tracker/:path*",
          destination: "/:path*",
          permanent: true,
        },
      ];
    }
    return list;
  },
  experimental: {
    // #447: lets a page answer 403 with `forbidden()` and app/forbidden.tsx.
    authInterrupts: true,
    // CI's build was killed when the runner ran out of memory; this lowers webpack's peak memory (docs: guides/memory-usage).
    webpackMemoryOptimizations: true,
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  webpack: (config, { nextRuntime }) => {
    // instrumentation.ts imports the ledger backfill only on Node. The edge
    // build still traces that import and then fails on net/tls/node:crypto.
    if (nextRuntime === "edge") {
      config.resolve.alias = {
        ...(typeof config.resolve.alias === "object" && !Array.isArray(config.resolve.alias)
          ? config.resolve.alias
          : {}),
        "@/lib/cron/scheduler": false,
        "@/lib/error-capture": false,
      };
    }
    return config;
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
