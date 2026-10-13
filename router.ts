// tiny-model-router: pick the smallest model that fits each task, under a project spend cap.
// Example models, prices, and tasks only. No model call. No network.

type Tier = "small" | "medium" | "large";

type Model = { name: string; tier: Tier; usdPer1kTokens: number; maxContext: number; tools: boolean };

type Task = { id: string; project: string; need: Tier; tokens: number; tools?: boolean; override?: string };

type Route =
  | { kind: "run"; task: string; model: string; cost: number; why: string }
  | { kind: "paused"; task: string; model: string; cost: number; why: string }
  | { kind: "rejected"; task: string; why: string };

const RANK: Record<Tier, number> = { small: 0, medium: 1, large: 2 };

const MODELS: Model[] = [
  { name: "mini", tier: "small", usdPer1kTokens: 0.0004, maxContext: 32_000, tools: false },
  { name: "mid", tier: "medium", usdPer1kTokens: 0.003, maxContext: 128_000, tools: true },
  { name: "big", tier: "large", usdPer1kTokens: 0.015, maxContext: 1_000_000, tools: true },
];

function fits(m: Model, t: Task): boolean {
  if (RANK[m.tier] < RANK[t.need]) return false;
  if (t.tokens > m.maxContext) return false;
  if (t.tools && !m.tools) return false;
  return true;
}

function cost(m: Model, t: Task): number {
  return Math.round((t.tokens / 1000) * m.usdPer1kTokens * 10_000) / 10_000;
}

function pick(t: Task): { model?: Model; why: string } {
  if (t.override) {
    const m = MODELS.find((x) => x.name === t.override);
    if (!m) return { why: `override "${t.override}" is not a known model` };
    if (!fits(m, t)) return { why: `override "${m.name}" does not fit this task` };
    return { model: m, why: "user override" };
  }
  const candidates = MODELS.filter((m) => fits(m, t)).sort((a, b) => cost(a, t) - cost(b, t));
  if (candidates.length === 0) return { why: "no model fits" };
  return { model: candidates[0], why: `cheapest model that fits (${candidates.length} fit)` };
}

class Ledger {
  spent = new Map<string, number>();
  constructor(private caps: Record<string, number>) {}

  route(t: Task): Route {
    const { model, why } = pick(t);
    if (!model) return { kind: "rejected", task: t.id, why };
    const c = cost(model, t);
    const spent = this.spent.get(t.project) ?? 0;
    const cap = this.caps[t.project] ?? 0;
    if (spent + c > cap) {
      return { kind: "paused", task: t.id, model: model.name, cost: c, why: `cap $${cap} would be hit (spent $${spent.toFixed(4)})` };
    }
    this.spent.set(t.project, Math.round((spent + c) * 10_000) / 10_000);
    return { kind: "run", task: t.id, model: model.name, cost: c, why };
  }

  raise(project: string, cap: number) {
    this.caps[project] = cap;
  }
}

// ===== EXAMPLE INPUTS (made-up tasks, prices, and caps) =====
const tasks: Task[] = [
  { id: "tag-email", project: "support", need: "small", tokens: 2_000 },
  { id: "draft-reply", project: "support", need: "medium", tokens: 6_000, tools: true },
  { id: "contract-review", project: "legal", need: "large", tokens: 180_000 },
  { id: "summarize-thread", project: "support", need: "small", tokens: 40_000 },
  { id: "quick-fix", project: "support", need: "small", tokens: 1_000, override: "big" },
  { id: "translate", project: "support", need: "small", tokens: 3_000, override: "gpt-x" },
  { id: "second-review", project: "legal", need: "large", tokens: 180_000 },
];

const TAG = { run: "[RUN]   ", paused: "[PAUSED]", rejected: "[REJECT]" } as const;

console.log("tiny-model-router demo");
const ledger = new Ledger({ support: 0.1, legal: 3 });
const paused: Task[] = [];
for (const t of tasks) {
  const r = ledger.route(t);
  const detail = r.kind === "rejected" ? r.why : `${r.model} $${r.cost.toFixed(4)}  ${r.why}`;
  console.log(`${TAG[r.kind]} ${t.id.padEnd(17)} ${detail}`);
  if (r.kind === "paused") paused.push(t);
}

console.log("\nraise legal cap to $6, resume paused work");
ledger.raise("legal", 6);
for (const t of paused) {
  const r = ledger.route(t);
  const detail = r.kind === "rejected" ? r.why : `${r.model} $${r.cost.toFixed(4)}  ${r.why}`;
  console.log(`${TAG[r.kind]} ${t.id.padEnd(17)} ${detail}`);
}
console.log("\nspent:", Object.fromEntries(ledger.spent));
