"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type SkillItem } from "./skills-data";
import { buildSmartSkillPrompt, type AgentInfo } from "./skills-prompt-builder";

export type AgentOption = AgentInfo;


interface SkillsDirectoryProps {
  skills: SkillItem[];
  loadError?: string;
  agents?: AgentOption[];
  isGuest?: boolean;
  /** The search box's starting text, from `/skills?search=` (a skill page's tag links). */
  initialSearch?: string;
}

/**
 * Public directory panel for the Skills Library.
 * Handles category filtering, real-time keyword search, agent targeting, and prompt copying.
 */
export function SkillsDirectory({
  skills,
  loadError,
  agents = [],
  isGuest = true,
  initialSearch = "",
}: SkillsDirectoryProps) {
  const router = useRouter();
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>(initialSearch);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Track the target agent chosen on each card, keyed by skill id.
  const [cardSelectedAgents, setCardSelectedAgents] = useState<Record<string, string>>({});

  // Category counts matching available skills
  const categories = useMemo(() => {
    return [
      { id: "all", label: "All Skills", count: skills.length },
      {
        id: "testing",
        label: "Testing & QA",
        count: skills.filter((s) => s.category === "testing").length,
      },
      {
        id: "security",
        label: "Security",
        count: skills.filter((s) => s.category === "security").length,
      },
      {
        id: "design",
        label: "Design & UI",
        count: skills.filter((s) => s.category === "design").length,
      },
      {
        id: "backend",
        label: "Backend & Database",
        count: skills.filter((s) => s.category === "backend").length,
      },
      {
        id: "marketing",
        label: "SEO & Content",
        count: skills.filter((s) => s.category === "marketing").length,
      },
    ];
  }, [skills]);

  // Filter skills by category and search query
  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      const matchesCategory =
        selectedCategory === "all" || skill.category === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        skill.title.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        skill.tags.some((tag) => tag.toLowerCase().includes(q));
      return matchesCategory && matchesSearch;
    });
  }, [skills, selectedCategory, searchQuery]);

  async function copyPrompt(skill: SkillItem, e?: React.MouseEvent) {
    e?.stopPropagation();
    e?.preventDefault();
    const targetAgent = cardSelectedAgents[skill.id];
    const promptText = buildSmartSkillPrompt(skill, targetAgent, agents);

    try {
      await navigator.clipboard.writeText(promptText);
      const targetAgentObj = agents.find((a) => a.name === targetAgent);
      const displayName = targetAgentObj
        ? targetAgentObj.username
          ? `${targetAgentObj.name} (@${targetAgentObj.username})`
          : targetAgentObj.name
        : targetAgent && targetAgent !== "all"
        ? targetAgent
        : "your agent";

      showToast(
        targetAgent && targetAgent !== "all"
          ? `Copied prompt with auto-sync for ${displayName}!`
          : `Copied "${skill.title}" prompt to clipboard!`
      );
    } catch {
      showToast("Unable to copy to clipboard.");
    }
  }

  function showToast(message: string) {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-8 pb-16">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl border border-zk-border bg-zk-surface px-5 py-3.5 text-sm font-semibold text-zk-text shadow-2xl transition-all"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zk-ok-bg text-zk-ok-fg text-xs font-bold">
            ✓
          </span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Hero Header */}
      <div className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-[-0.03em] text-zk-text">
              Agent Skills Library
            </h1>
            <p className="text-sm text-zk-text2 leading-relaxed max-w-[680px]">
              Discover tested agent prompts, verification scripts, and security
              guardrails published by the community.
            </p>
          </div>
          <Link
            href="/skills/contribute"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-control bg-blue-600 px-6 py-2.5 text-sm font-bold text-white hover:opacity-90 transition shrink-0"
          >
            <span>+ Submit a Skill</span>
          </Link>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-y border-zk-divider py-4">
        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              aria-pressed={selectedCategory === cat.id}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                selectedCategory === cat.id
                  ? "bg-blue-600 text-white shadow-xs"
                  : "bg-zk-chip text-zk-muted hover:text-zk-text hover:bg-zk-border/60"
              }`}
            >
              <span>{cat.label}</span>
              <span
                className={`rounded-full px-1.5 text-[10px] font-bold ${
                  selectedCategory === cat.id
                    ? "bg-white/20 text-white"
                    : "bg-zk-surface text-zk-muted"
                }`}
              >
                {cat.count}
              </span>
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64 shrink-0">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search skills or tags..."
            aria-label="Search skills or tags"
            className="w-full rounded-full border border-zk-border bg-zk-surface px-4 py-1.5 text-xs text-zk-text placeholder:text-zk-muted focus:border-blue-600 focus:outline-hidden"
          />
        </div>
      </div>

      {/* Empty State */}
      {loadError ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-12 text-center space-y-3">
          <p className="text-base font-semibold text-rose-600 dark:text-rose-400">
            Failed to load skills library
          </p>
          <p className="text-xs text-zk-muted max-w-sm mx-auto">{loadError}</p>
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="rounded-2xl border border-zk-border bg-zk-surface/50 p-12 text-center space-y-3">
          <p className="text-base font-semibold text-zk-text">No skills found</p>
          <p className="text-xs text-zk-muted max-w-sm mx-auto">
            {searchQuery
              ? `No skills matched your search query "${searchQuery}".`
              : "No approved skills published in this category yet."}
          </p>
        </div>
      ) : (
        /* Skill Cards Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSkills.map((skill) => {
            const selectedAgent = cardSelectedAgents[skill.id] || "all";

            return (
              <div
                key={skill.id}
                role="link"
                tabIndex={0}
                onClick={(e) => {
                  const target = e.target as HTMLElement | null;
                  if (target?.closest("button, a, select, input, label, [data-prevent-card-click]")) {
                    return;
                  }
                  router.push(`/skills/${skill.slug}`);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    router.push(`/skills/${skill.slug}`);
                  }
                }}
                className="group flex flex-col justify-between rounded-2xl border border-zk-border bg-zk-surface p-6 hover:border-blue-500/40 hover:shadow-lg transition-all space-y-4 cursor-pointer"
              >
                <div className="space-y-3.5">
                  {/* Top Bar: Icon (links to skill detail) */}
                  <div className="flex items-center justify-between gap-3">
                    <Link
                      href={`/skills/${skill.slug}`}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition cursor-pointer"
                      title="View details & spec"
                    >
                      <SkillIcon icon={skill.icon} />
                    </Link>
                  </div>

                  {/* Category & Title */}
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => setSelectedCategory(skill.category)}
                      className="text-[11px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider hover:underline hover:text-blue-700 dark:hover:text-blue-300 text-left transition cursor-pointer"
                      title={`Filter by ${skill.categoryLabel}`}
                    >
                      {skill.categoryLabel}
                    </button>
                    <h2 className="text-base font-bold text-zk-text leading-snug hover:text-blue-600 transition">
                      <Link href={`/skills/${skill.slug}`}>{skill.title}</Link>
                    </h2>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-zk-text2 leading-relaxed">
                    {skill.description}
                  </p>

                  {/* Tags */}
                  {skill.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {skill.tags.slice(0, 4).map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setSearchQuery(tag)}
                          className="rounded-md bg-zk-chip hover:bg-zk-border px-2 py-0.5 text-[10px] font-medium text-zk-muted hover:text-zk-text transition cursor-pointer"
                          title={`Search for #${tag}`}
                        >
                          #{tag}
                        </button>
                      ))}
                      {skill.tags.length > 4 && (
                        <span className="text-[10px] text-zk-muted self-center">
                          +{skill.tags.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Bottom Actions: Agent Dropdown & Copy Prompt */}
                <div className="space-y-2.5 border-t border-zk-divider pt-4" data-prevent-card-click="true">
                  {/* Agent Target Dropdown */}
                  <div className="relative">
                    <select
                      onClick={(e) => e.stopPropagation()}
                      value={selectedAgent}
                      onChange={(e) =>
                        setCardSelectedAgents((prev) => ({
                          ...prev,
                          [skill.id]: e.target.value,
                        }))
                      }
                      aria-label={`Target agent for ${skill.title}`}
                      className="w-full appearance-none rounded-xl border border-zk-border bg-zk-chip/60 hover:bg-zk-chip py-2 pl-3.5 pr-8 text-xs font-semibold text-zk-text focus:border-blue-600 focus:outline-hidden transition cursor-pointer"
                    >
                      {agents.length > 0 ? (
                        <>
                          <option value="all">For: All My Agents</option>
                          {agents.map((agent) => (
                            <option key={agent.id} value={agent.name}>
                              For: {agent.name}{agent.username ? ` (@${agent.username})` : ""}
                            </option>
                          ))}
                        </>
                      ) : (
                        <option value="all">
                          {isGuest ? "For: Any Agent" : "For: Default Agent"}
                        </option>
                      )}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-zk-muted">
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {/* Copy Button */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); copyPrompt(skill, e); }}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-zk-border bg-zk-surface hover:bg-zk-chip py-2.5 text-xs font-bold text-zk-text shadow-xs hover:border-zk-border-hover transition"
                  >
                    <svg className="h-3.5 w-3.5 text-zk-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span>Copy Agent Skill Prompt</span>
                  </button>

                  <Link
                    href={`/skills/${skill.slug}`}
                    className="flex w-full items-center justify-center gap-1.5 text-center text-xs font-medium text-zk-muted hover:text-blue-600 transition py-0.5"
                  >
                    <span>View Details &amp; Spec</span>
                    <span>→</span>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SkillIcon({ icon, className = "h-5 w-5" }: { icon: SkillItem["icon"]; className?: string }) {
  const iconClass = className;
  switch (icon) {
    case "flutter":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      );
    case "shield":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      );
    case "browser":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
      );
    case "figma":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      );
    case "database":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
        </svg>
      );
    case "a11y":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      );
    case "test":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      );
    case "seo":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
        </svg>
      );
    case "api":
    default:
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
  }
}
