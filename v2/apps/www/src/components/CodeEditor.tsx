import { useState, useEffect, useRef } from "react";

const CODE_EXAMPLE = `// Your agent writes TypeScript — not JSON tool calls
const zones = await tools.cloudflare.list_zones({
  account: { id: env.CF_ACCOUNT_ID },
})

const zone = zones.result.find(z => z.name === "example.com")

// Create a DNS record
await tools.cloudflare.create_dns_record({
  zone_id: zone.id,
  type: "A",
  name: "api",
  content: "192.0.2.1",
  proxied: true,
})

// Check deployment status
const deploys = await tools.vercel.listDeployments({
  teamId: env.VERCEL_TEAM_ID,
  limit: 5,
})

return {
  zone: zone.name,
  dnsRecordCreated: true,
  recentDeploys: deploys.deployments.map(d => ({
    url: d.url,
    state: d.readyState,
    created: d.created,
  })),
}`;

const OUTPUT = `{
  "zone": "example.com",
  "dnsRecordCreated": true,
  "recentDeploys": [
    {
      "url": "my-app-abc123.vercel.app",
      "state": "READY",
      "created": 1703044800000
    },
    {
      "url": "my-app-def456.vercel.app",
      "state": "READY",
      "created": 1703041200000
    }
  ]
}`;

export function CodeEditor() {
  const [isRunning, setIsRunning] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  const handleRun = () => {
    setIsRunning(true);
    setShowOutput(false);
    setTimeout(() => {
      setIsRunning(false);
      setShowOutput(true);
    }, 1500);
  };

  useEffect(() => {
    if (showOutput && outputRef.current) {
      outputRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [showOutput]);

  return (
    <div>
      <div className="bg-surface border border-white/[0.06] rounded-lg overflow-hidden">
        {/* Editor header */}
        <div className="px-4 py-3 bg-white/[0.02] border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[0.65rem] uppercase tracking-widest text-white/30">
              execute.ts
            </span>
            <span className="text-[0.6rem] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/30">
              TypeScript
            </span>
          </div>
          <button
            onClick={handleRun}
            disabled={isRunning}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${
              isRunning
                ? "bg-white/10 text-white/40 cursor-wait"
                : "bg-[#f5f5f5] text-surface hover:bg-white/90 active:scale-[0.98]"
            }`}
          >
            {isRunning ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
                Running...
              </span>
            ) : (
              "▶ Run"
            )}
          </button>
        </div>
        {/* Code body */}
        <div className="p-4 overflow-x-auto">
          <pre className="!m-0 !p-0 !bg-transparent !border-none">
            <code className="!bg-transparent !p-0 font-mono text-[0.8rem] leading-7 text-white/70">
              {CODE_EXAMPLE}
            </code>
          </pre>
        </div>
      </div>
      {/* Output */}
      {(isRunning || showOutput) && (
        <div ref={outputRef} className="mt-3 bg-surface border border-white/[0.06] rounded-lg overflow-hidden animate-log-fade-in">
          <div className="px-4 py-3 bg-white/[0.02] border-b border-white/[0.06] flex items-center gap-2">
            <span className="text-[0.65rem] uppercase tracking-widest text-white/30">
              output
            </span>
            {isRunning && (
              <span className="w-3 h-3 border-2 border-white/20 border-t-green-400 rounded-full animate-spin" />
            )}
            {showOutput && (
              <span className="text-[0.65rem] text-green-400">
                ✓ completed in 1.2s
              </span>
            )}
          </div>
          <div className="p-4 overflow-x-auto">
            {isRunning ? (
              <div className="font-mono text-xs text-white/30 space-y-2">
                <div className="animate-pulse">→ Resolving tool: cloudflare.list_zones...</div>
                <div className="animate-pulse" style={{ animationDelay: "0.3s" }}>→ Policy check: allow (matched role "Infrastructure Admin")</div>
                <div className="animate-pulse" style={{ animationDelay: "0.6s" }}>→ Executing with credentials: cf_api_token_****</div>
              </div>
            ) : (
              <pre className="!m-0 !p-0 !bg-transparent !border-none">
                <code className="!bg-transparent !p-0 font-mono text-[0.8rem] leading-7 text-green-400/70">
                  {OUTPUT}
                </code>
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
