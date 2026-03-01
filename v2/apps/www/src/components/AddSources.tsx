import { useState } from "react";

interface Source {
  id: string;
  name: string;
  icon: string;
  toolCount: number;
  description: string;
}

const SOURCES: Source[] = [
  {
    id: "cloudflare",
    name: "Cloudflare",
    icon: "☁",
    toolCount: 1347,
    description: "DNS, Workers, R2, KV, Zones, WAF, and more",
  },
  {
    id: "vercel",
    name: "Vercel",
    icon: "▲",
    toolCount: 289,
    description: "Deployments, Domains, Environment Variables, Projects",
  },
  {
    id: "posthog",
    name: "PostHog",
    icon: "🦔",
    toolCount: 156,
    description: "Events, Funnels, Feature Flags, Session Recordings",
  },
  {
    id: "github",
    name: "GitHub",
    icon: "⬡",
    toolCount: 892,
    description: "Repos, Issues, Pull Requests, Actions, Packages",
  },
  {
    id: "stripe",
    name: "Stripe",
    icon: "◈",
    toolCount: 614,
    description: "Charges, Subscriptions, Invoices, Customers, Payouts",
  },
  {
    id: "linear",
    name: "Linear",
    icon: "◇",
    toolCount: 203,
    description: "Issues, Projects, Cycles, Teams, Labels",
  },
];

export function AddSources() {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(["cloudflare", "vercel", "posthog"]),
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalTools = SOURCES.filter((s) => selected.has(s.id)).reduce(
    (sum, s) => sum + s.toolCount,
    0,
  );

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {SOURCES.map((source) => {
          const isSelected = selected.has(source.id);
          return (
            <button
              key={source.id}
              onClick={() => toggle(source.id)}
              className={`group text-left p-4 rounded-lg border transition-all duration-200 ${
                isSelected
                  ? "border-accent/40 bg-accent/[0.06]"
                  : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <span className="text-lg">{source.icon}</span>
                  <span className="font-medium text-sm text-[#f5f5f5]">
                    {source.name}
                  </span>
                </div>
                <div
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                    isSelected
                      ? "border-accent bg-accent"
                      : "border-white/20 bg-transparent"
                  }`}
                >
                  {isSelected && (
                    <svg
                      className="w-2.5 h-2.5 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </div>
              </div>
              <p className="text-xs text-white/40 leading-relaxed">
                {source.description}
              </p>
              <div className="mt-2 text-[0.65rem] uppercase tracking-widest text-white/25">
                {source.toolCount.toLocaleString()} tools
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-6 flex items-center justify-between text-sm">
        <span className="text-white/40">
          <span className="text-[#f5f5f5] font-medium">
            {selected.size}
          </span>{" "}
          sources selected
        </span>
        <span className="text-white/40">
          <span className="text-accent font-mono font-medium">
            {totalTools.toLocaleString()}
          </span>{" "}
          tools available
        </span>
      </div>
    </div>
  );
}
