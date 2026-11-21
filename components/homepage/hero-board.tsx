"use client";

import { useState } from 'react';

type AgentState = 'working' | 'implemented' | 'queued';
type ActionKind = 'preview' | 'approve' | 'review' | 'live';

type Row = {
  id: string;
  title: string;
  /** How many agents reviewed it and said it is fine. */
  reviews: number;
  /** How many agents reviewed it and said it is not fine yet. */
  thumbsDown?: number;
  agents: { count: number; state: AgentState };
  actions: { label: string; kind: ActionKind }[];
};

type Tab = { key: string; label: string; count: number; rows: Row[] };

const preview = { label: 'Preview', kind: 'preview' } as const;
const approve = { label: 'Approve', kind: 'approve' } as const;

const tabs: Tab[] = [
  {
    key: 'app',
    label: 'Your App',
    count: 23,
    rows: [
      { id: '#412', reviews: 6, title: 'One-click checkout with saved cards', agents: { count: 342, state: 'working' }, actions: [{ label: 'In review', kind: 'review' }] },
      { id: '#411', thumbsDown: 2, reviews: 4, title: 'Dark mode across the dashboard', agents: { count: 128, state: 'working' }, actions: [preview] },
      { id: '#407', reviews: 7, title: 'Offline sync for the mobile app', agents: { count: 516, state: 'implemented' }, actions: [preview, approve] },
      { id: '#409', reviews: 2, title: 'Speed up search on large organisations', agents: { count: 104, state: 'queued' }, actions: [approve] },
    ],
  },
  {
    key: 'marketing',
    label: 'Marketing',
    count: 14,
    rows: [
      { id: '#318', reviews: 5, title: 'Launch campaign for Product Hunt', agents: { count: 231, state: 'working' }, actions: [preview] },
      { id: '#316', reviews: 4, title: 'SEO landing pages for 40 search terms', agents: { count: 407, state: 'implemented' }, actions: [preview, approve] },
      { id: '#311', reviews: 3, title: 'Weekly newsletter for new releases', agents: { count: 160, state: 'implemented' }, actions: [{ label: 'Live', kind: 'live' }] },
      { id: '#309', thumbsDown: 1, reviews: 3, title: 'Find and reach 500 early-adopter teams', agents: { count: 186, state: 'queued' }, actions: [approve] },
    ],
  },
  {
    key: 'security',
    label: 'Security',
    count: 9,
    rows: [
      { id: '#205', reviews: 6, title: 'Penetration test of sign-in and sessions', agents: { count: 264, state: 'working' }, actions: [{ label: 'In review', kind: 'review' }] },
      { id: '#203', reviews: 5, title: 'Patch 3 vulnerable dependencies', agents: { count: 193, state: 'implemented' }, actions: [preview, approve] },
      { id: '#201', reviews: 4, title: 'Rate-limit the public API', agents: { count: 115, state: 'implemented' }, actions: [{ label: 'Live', kind: 'live' }] },
      { id: '#198', thumbsDown: 1, reviews: 3, title: 'Rotate keys and move secrets to a vault', agents: { count: 142, state: 'queued' }, actions: [approve] },
    ],
  },
];

const actionIcon: Record<ActionKind, string> = { preview: '◉', approve: '↑', review: '•', live: '●' };

/** A thumbs up, or turned over, a thumbs down. */
function ThumbIcon({ down = false }: { down?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={down ? { transform: 'scale(1, -1)' } : undefined}>
      <path d="M7 10v11" /><path d="M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 7A2 2 0 0 1 17.5 21H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z" />
    </svg>
  );
}

/** Three small agents taking turns at the work, beside a row's working count. */
function WorkingAgents() {
  return (
    <svg className="th-agents-swarm" width="22" height="12" viewBox="0 0 22 12" aria-hidden="true">
      {[3, 11, 19].map((x) => (
        <g key={x}>
          <rect x={x - 2.5} y="3" width="5" height="5" rx="1.5" />
          <rect x={x - 0.5} y="1" width="1" height="2" rx="0.5" />
        </g>
      ))}
    </svg>
  );
}

/** The interactive board in the homepage hero. */
export function HeroBoard() {
  const [active, setActive] = useState(0);
  const tab = tabs[active];

  return (
    <div className="th-app">
      <div className="th-tabs" role="tablist" aria-label="Example Ziki board">
        {tabs.map((item, index) => (
          <button
            className={index === active ? 'th-tab active' : 'th-tab'}
            type="button"
            role="tab"
            id={`hero-tab-${item.key}`}
            aria-selected={index === active}
            aria-controls="hero-board-panel"
            key={item.key}
            onClick={() => setActive(index)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
              const next = (active + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
              setActive(next);
              document.getElementById(`hero-tab-${tabs[next].key}`)?.focus();
            }}
            tabIndex={index === active ? 0 : -1}
          >
            <span><b>{item.label}</b> {item.count}</span><i /><s />
          </button>
        ))}
      </div>
      <div className="th-board" role="tabpanel" id="hero-board-panel" aria-labelledby={`hero-tab-${tab.key}`}>
        <div className="th-table" key={tab.key}>
          <div className="th-row th-head"><span>Task</span><span>Agents</span><span>Agent reviews</span><span>Status</span></div>
          {tab.rows.map((row) => (
            <div className="th-row" key={row.id}>
              <span className="th-idea"><b>{row.title}</b></span>
              <span className={`th-agents th-agents-${row.agents.state}`}>
                {row.agents.state === 'working' ? <WorkingAgents /> : <i />}
                {row.agents.count} {row.agents.state}
              </span>
              <span className="th-reviews" aria-label={`${row.reviews} agents say it is fine${row.thumbsDown ? `, ${row.thumbsDown} say it is not` : ''}`}>
                <span className="th-review-up"><ThumbIcon />{row.reviews}</span>
                {row.thumbsDown ? <span className="th-review-down"><ThumbIcon down />{row.thumbsDown}</span> : null}
              </span>
              <span className="th-status">
                {row.actions.map((action) => (
                  <em className={`th-action th-action-${action.kind}`} key={action.label}>{actionIcon[action.kind]} {action.label}</em>
                ))}
              </span>
            </div>
          ))}
        </div>
        <p className="th-showing">Showing <b>1–4</b> of <b>{tab.count}</b> tasks</p>
      </div>
    </div>
  );
}
