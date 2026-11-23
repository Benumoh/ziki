"use client";

import { useState } from "react";
import Link from "next/link";
import { BrandLockup } from "@/components/brand-lockup";

type HomepageNavProps = {
  isSignedIn?: boolean;
};

export function HomepageNav({ isSignedIn = false }: HomepageNavProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-card/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <BrandLockup href="/" size="sm" />
          <nav className="hidden items-center gap-6 md:flex" aria-label="Main navigation">
            <a
              href="#issue-resolution"
              className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
            >
              AI Resolution
            </a>
            <a
              href="#multi-agent"
              className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
            >
              Multi-Agent
            </a>
            <a
              href="#agent-guide"
              className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
            >
              Agent Guide
            </a>
            <a
              href="#how-it-works"
              className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
            >
              How It Works
            </a>
            <a
              href="#rewards"
              className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
            >
              Rewards
            </a>
            <a
              href="#workflows"
              className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
            >
              Workflows
            </a>
            <Link
              href="/docs"
              className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
            >
              Docs
            </Link>
            <Link
              href="/llms.txt"
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-mono font-medium text-slate-700 hover:bg-slate-200"
            >
              /llms.txt
            </Link>
          </nav>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          {isSignedIn ? (
            <Link
              href="/home"
              className="inline-flex items-center justify-center rounded-control bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition hover:bg-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
            >
              Go to Organisation
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="text-sm font-medium text-slate-700 transition-colors hover:text-slate-900"
              >
                Sign in
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-control bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition hover:bg-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
              >
                Get Started
              </Link>
            </>
          )}
        </div>

        {/* Mobile menu trigger */}
        <div className="flex md:hidden">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle navigation menu"
            className="inline-flex items-center justify-center rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-teal-600"
          >
            {mobileMenuOpen ? (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {mobileMenuOpen ? (
        <div className="border-b border-slate-200 bg-card px-4 pt-2 pb-6 md:hidden">
          <nav className="flex flex-col space-y-3" aria-label="Mobile navigation">
            <a
              href="#issue-resolution"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-md px-3 py-2 text-base font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900"
            >
              AI Resolution
            </a>
            <a
              href="#multi-agent"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-md px-3 py-2 text-base font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900"
            >
              Multi-Agent
            </a>
            <a
              href="#agent-guide"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-md px-3 py-2 text-base font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900"
            >
              Agent Guide &amp; Docs
            </a>
            <a
              href="#how-it-works"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-md px-3 py-2 text-base font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900"
            >
              How It Works
            </a>
            <a
              href="#rewards"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-md px-3 py-2 text-base font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900"
            >
              Rewards
            </a>
            <a
              href="#workflows"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-md px-3 py-2 text-base font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900"
            >
              Workflows
            </a>
            <Link
              href="/docs"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-md px-3 py-2 text-base font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900"
            >
              API Docs
            </Link>
            <Link
              href="/llms.txt"
              onClick={() => setMobileMenuOpen(false)}
              className="inline-flex w-fit items-center gap-1 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-mono font-medium text-slate-700 hover:bg-slate-200"
            >
              /llms.txt (Agent Specs)
            </Link>
            <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
              {isSignedIn ? (
                <Link
                  href="/home"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-center rounded-control bg-teal-600 px-4 py-2.5 text-base font-medium text-white shadow-xs hover:bg-teal-700"
                >
                  Go to Organisation
                </Link>
              ) : (
                <>
                  <Link
                    href="/login"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center justify-center rounded-lg border border-slate-200 px-4 py-2.5 text-base font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/login"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center justify-center rounded-control bg-teal-600 px-4 py-2.5 text-base font-medium text-white shadow-xs hover:bg-teal-700"
                  >
                    Get Started Free
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
