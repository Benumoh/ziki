"use client";

import React, { useState, useEffect, useRef, useMemo, Suspense, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SupportGuideAvatar } from "./support-guide-avatar";
import { FloatingAgentLauncher } from "@/components/floating-agent-launcher";
import {
  getPageGuidance,
  searchSupportAnswers,
  FAQItem,
  NavigationAction,
} from "./support-guide-data";
import { useProjectRef } from "@/lib/use-project-ref";
import { isAuthPage, isExternalPage } from "@/lib/external-pages";

export type GuideMode = "avatar" | "chat" | "tour";

interface Message {
  id: string;
  sender: "agent" | "user";
  text: string;
  time: string;
  actions?: NavigationAction[];
}

function getFormattedTime() {
  const d = new Date();
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${hours}:${mins}`;
}

/** Never changes on its own; every render re-reads the shell marker. */
const subscribeToAppShell = () => () => {};
const appShellSnapshot = () =>
  typeof document !== "undefined" &&
  Boolean(document.querySelector("[data-app-shell]"));

function OnScreenGuideContent() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const projectSlug = useProjectRef();

  // Compute page guidance directly from pathname during render
  const pageGuidance = useMemo(
    () => getPageGuidance(pathname || "/", projectSlug),
    [pathname, projectSlug]
  );

  const [mode, setMode] = useState<GuideMode>(() => {
    const requested = searchParams.get("guide_state") as GuideMode;
    if (requested && ["avatar", "chat", "tour"].includes(requested)) {
      return requested;
    }
    return "avatar";
  });

  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: "msg-init",
      sender: "agent",
      text: `Hello! I'm your Ziki Support Guide. You are currently on **${pageGuidance.pageName}** (${pageGuidance.shortTag}). \n\n${pageGuidance.welcomeIntro}\n\nFeeling lost or looking for a specific page? Ask me anything or select a shortcut below!`,
      time: getFormattedTime(),
    },
  ]);

  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  const messageCountRef = useRef(1);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll chat to bottom when messages update
  useEffect(() => {
    if (mode === "chat") {
      chatBottomRef.current?.scrollIntoView?.({ behavior: "smooth" });
    }
  }, [messages, mode, isTyping]);

  // Handle ESC key to minimize
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (mode !== "avatar") {
          setMode("avatar");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode]);

  const handleNavigate = (href: string) => {
    router.push(href);
  };

  const handleSendMessage = (textToSend?: string, directAction?: NavigationAction) => {
    const text = (textToSend || inputValue).trim();
    if (!text) return;

    messageCountRef.current += 1;
    const userMsg: Message = {
      id: `user-msg-${messageCountRef.current}`,
      sender: "user",
      text,
      time: getFormattedTime(),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputValue("");
    setIsTyping(true);

    // Simulate smart support agent response
    setTimeout(() => {
      messageCountRef.current += 1;
      const result = searchSupportAnswers(text, projectSlug);

      const combinedActions: NavigationAction[] = [];
      if (directAction) {
        combinedActions.push(directAction);
      }
      if (result.actions) {
        for (const act of result.actions) {
          if (!combinedActions.some((a) => a.href === act.href)) {
            combinedActions.push(act);
          }
        }
      }

      const agentMsg: Message = {
        id: `agent-msg-${messageCountRef.current}`,
        sender: "agent",
        text: result.text,
        time: getFormattedTime(),
        actions: combinedActions.length > 0 ? combinedActions : undefined,
      };
      setMessages((prev) => [...prev, agentMsg]);
      setIsTyping(false);
    }, 400);
  };

  const handleSelectFAQ = (faq: FAQItem) => {
    const directAction = faq.actionHref && faq.actionLabel
      ? { label: faq.actionLabel, href: faq.actionHref }
      : undefined;
    handleSendMessage(faq.question, directAction);
  };

  const startTour = () => {
    setTourStep(0);
    setMode("tour");
  };

  const tourSteps = [
    {
      title: "Step 1: The Core Workflow (Ideas & Issues)",
      body: "Everything in Ziki starts as an Idea in the Ideas tab. When community votes hit the threshold, ideas convert into confirmed Issues ready for work.",
      highlight: "Ideas & Issues tabs in the top navigation",
    },
    {
      title: "Step 2: Autonomous Agent Bidding",
      body: "AI agents monitor the work feed 24/7. They submit bids with estimates and claim tickets. Once claimed, agents code the fix and deliver evidence.",
      highlight: "Status pipeline: Open → In progress → Done",
    },
    {
      title: "Step 3: Human Verification & 'Your Call'",
      body: "Before code merges, independent testers verify quality. If agents deadlock, 'Your Call' gives human leaders the deciding choice.",
      highlight: "Done & Merge stages, and Your Call cards",
    },
    {
      title: "Step 4: Your Support Guide Always Nearby",
      body: "Whenever you feel stuck, confused by agent activity, or need to know your next step, just click this support avatar anytime!",
      highlight: "Bottom right support avatar",
    },
  ];

  // Signed-in shell? The server renders the pre-login guide; the client
  // re-renders into the launcher inside [data-app-shell]. getSnapshot stays a
  // primitive so React never loops.
  const isInsideApp = useSyncExternalStore(
    subscribeToAppShell,
    appShellSnapshot,
    () => false,
  );
  return (
    // Above the support link (a small line at the bottom right). Where the agents bar is drawn (#agents-dock,
    // 76px tall) the bot sits inside it, at its right end, and its chat opens upward from there. Decided in CSS,
    // not at render, so the server and the browser draw the same thing.
    <aside
      aria-label="Customer Support Guide"
      className="fixed bottom-14 right-4 z-50 flex flex-col items-end pointer-events-none select-none sm:right-6 lg:[body:has([data-dock-strip])_&]:bottom-[10px]"
    >
      {/* ---------------- STATE 3: INTERACTIVE SUPPORT DRAWER / CHAT ---------------- */}
      {mode === "chat" && (
        <div className="pointer-events-auto flex h-[min(530px,calc(100vh-9rem))] w-[min(350px,calc(100vw-2rem))] sm:w-[420px] flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1938] shadow-2xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-4">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-blue-950/40 bg-gradient-to-r from-blue-700 to-indigo-900 px-4 py-3 text-white">
            <div className="flex items-center gap-3">
              <SupportGuideAvatar size="sm" isOnline={true} animated={false} />
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[14px] font-bold leading-tight">Ziki Support Guide</span>
                  <span className="rounded bg-emerald-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                    Human Concierge
                  </span>
                </div>
                <p className="text-[11px] text-blue-100">
                  Context: <span className="font-semibold text-white">{pageGuidance.pageName}</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMode("avatar")}
                title="Minimize"
                className="rounded p-1 text-blue-200 hover:bg-white/10 hover:text-white"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setMode("avatar")}
                title="Close"
                className="rounded p-1 text-blue-200 hover:bg-white/10 hover:text-white"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Quick Page Info Strip */}
          <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-4 py-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-500 dark:text-slate-400">
                Tip: <strong className="text-slate-800 dark:text-slate-200">{pageGuidance.shortTag}</strong>
              </span>
              <button
                type="button"
                onClick={startTour}
                className="font-semibold text-electric-blue hover:underline"
              >
                Start Walkthrough →
              </button>
            </div>
          </div>

          {/* Scrollable Chat Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-[13px] bg-slate-50/50 dark:bg-[#0c1938]">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 leading-relaxed shadow-xs ${
                    msg.sender === "user"
                      ? "bg-electric-blue-strong text-white rounded-br-xs"
                      : "border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-bl-xs"
                  }`}
                >
                  <p className="whitespace-pre-line">{msg.text}</p>

                  {/* Interactive Direct Navigation Actions */}
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="mt-3 flex flex-col gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-700">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                        Direct Page Shortcuts:
                      </span>
                      {msg.actions.map((act) => (
                        <button
                          key={act.href}
                          type="button"
                          onClick={() => handleNavigate(act.href)}
                          className="group flex flex-col items-start rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-950/40 px-3 py-2 text-left hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors shadow-xs"
                        >
                          <span className="text-[12px] font-bold text-electric-blue-strong group-hover:underline flex items-center gap-1">
                            {act.label} <span className="transition-transform group-hover:translate-x-0.5">→</span>
                          </span>
                          {act.description && (
                            <span className="text-[11px] text-slate-600 dark:text-slate-400">
                              {act.description}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <span className="mt-1 px-1 text-[10px] text-slate-400">{msg.time}</span>
              </div>
            ))}

            {isTyping && (
              <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 w-20 text-slate-400 text-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" />
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0.2s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0.4s]" />
              </div>
            )}

            {/* Suggested Questions Pills */}
            <div className="pt-2">
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                Suggested Questions & Navigation:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {pageGuidance.faqs.map((faq) => (
                  <button
                    key={faq.id}
                    type="button"
                    onClick={() => handleSelectFAQ(faq)}
                    className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-left shadow-xs"
                  >
                    {faq.question}
                  </button>
                ))}
              </div>
            </div>

            <div ref={chatBottomRef} />
          </div>

          {/* Input Box */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1938] p-2.5 flex items-center gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask anything or say 'take me to ideas/issues'..."
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-[12px] text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-electric-blue focus:outline-none"
            />
            <button
              type="submit"
              disabled={!inputValue.trim()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-electric-blue-strong text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </form>
        </div>
      )}

      {/* ---------------- STATE 4: GUIDED WALKTHROUGH OVERLAY / BANNER ---------------- */}
      {mode === "tour" && (
        <div className="pointer-events-auto w-80 sm:w-96 rounded-2xl border-2 border-electric-blue bg-white dark:bg-[#0c1938] p-4 shadow-2xl animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-electric-blue uppercase tracking-wider">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              Ziki Guided Tour ({tourStep + 1} of {tourSteps.length})
            </span>
            <button
              type="button"
              onClick={() => setMode("avatar")}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700"
            >
              ✕
            </button>
          </div>

          <div className="mt-3">
            <h4 className="text-[14px] font-bold text-slate-900 dark:text-white">
              {tourSteps[tourStep].title}
            </h4>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
              {tourSteps[tourStep].body}
            </p>
            <div className="mt-2 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 p-2 text-[11px] text-blue-700 dark:text-blue-300 font-medium">
              👀 Look for: {tourSteps[tourStep].highlight}
            </div>
          </div>

          {/* Stepper controls */}
          <div className="mt-4 flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              disabled={tourStep === 0}
              onClick={() => setTourStep((prev) => Math.max(0, prev - 1))}
              className="rounded px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
            >
              ← Back
            </button>
            <div className="flex items-center gap-1">
              {tourSteps.map((_, idx) => (
                <span
                  key={idx}
                  className={`h-1.5 rounded-full transition-all ${
                    idx === tourStep ? "w-4 bg-electric-blue" : "w-1.5 bg-slate-200 dark:bg-slate-700"
                  }`}
                />
              ))}
            </div>
            {tourStep < tourSteps.length - 1 ? (
              <button
                type="button"
                onClick={() => setTourStep((prev) => prev + 1)}
                className="rounded bg-electric-blue-strong px-3 py-1 text-[11px] font-semibold text-white hover:opacity-90"
              >
                Next Step →
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setMode("chat")}
                className="rounded bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:opacity-90"
              >
                Finished! Ask Questions
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---------------- STATE 1: THE BOT (Always accessible anchor) ---------------- */}
      <div className="pointer-events-auto flex items-center gap-2">
        {isInsideApp ? (
          /* Signed in: one bot that rolls out support, a game and the agents
             directory. The pre-login guide below is deliberately unchanged. */
          <FloatingAgentLauncher
            embedded
            onSupport={() => setMode("chat")}
            onOpenChange={(isOpen) => {
              if (isOpen) setMode("avatar");
            }}
            icon={<SupportGuideAvatar size="lg" isOnline={true} animated={true} />}
            buttonClassName="h-14 w-14 bg-gradient-to-tr from-blue-600 to-indigo-600 p-1 shadow-xl hover:scale-105 active:scale-95"
          />
        ) : (
          <>
        {mode === "avatar" && (
          <button
            type="button"
            onClick={() => setMode("chat")}
            className="cursor-pointer group flex items-center gap-2 rounded-full border border-slate-200/90 dark:border-slate-700 bg-white/95 dark:bg-[#0c1938]/95 px-3.5 py-2 shadow-lg backdrop-blur-md transition-all duration-200 hover:border-electric-blue hover:shadow-xl focus-visible:outline-2 focus-visible:outline-electric-blue text-left"
          >
            <span className="flex flex-col">
              <span className="text-[12px] font-bold text-slate-900 dark:text-white group-hover:text-electric-blue">
                Lost? Ask Support
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                Human Guide • Online
              </span>
            </span>
          </button>
        )}

        {/* Avatar button */}
        <button
          type="button"
          onClick={() => setMode((prev) => (prev === "avatar" ? "chat" : "avatar"))}
          aria-label="Toggle Ziki Customer Support Guide"
          className="group relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 p-1 shadow-xl transition-transform duration-200 hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-electric-blue"
        >
          <SupportGuideAvatar size="lg" isOnline={true} animated={true} />
          <span className="sr-only">Toggle Customer Support Guide</span>
        </button>
          </>
        )}
      </div>
    </aside>
  );
}

export function OnScreenGuide() {
  // The public site's pages and the pages for getting in show no support bot (#external-pages-light).
  const pathname = usePathname();
  if (isExternalPage(pathname) || isAuthPage(pathname)) return null;
  return (
    <Suspense fallback={null}>
      <OnScreenGuideContent />
    </Suspense>
  );
}
