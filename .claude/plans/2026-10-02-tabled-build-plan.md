# Tabled Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native, single session) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Build window is 60 minutes. Task order is the cut order in reverse: if time runs out, the last tasks are the ones to drop.

**Goal:** A single-page Next.js app that reads a seeded student's transactions, matches them against a student-discount catalog, and shows "$X / year left on the table" with five fixes, a two-sentence Gemini summary, and a chat rail.

**Architecture:** Deterministic matcher (pure function over two JSON files) computes every number. Gemini only rewrites findings into prose and answers chat; it never invents a figure. No database, no auth, no live Plaid. One server component renders the dashboard; two route handlers stream Gemini.

**Tech Stack:** Next.js (App Router, latest), TypeScript, Tailwind v4, shadcn/ui (Button, Input, Badge, ScrollArea), `motion` (framer-motion), AI SDK (`ai`, `@ai-sdk/google`, `@ai-sdk/react`), Gemini 2.5 Flash free tier, vitest, Bun, Vercel Hobby.

**Spec:** Design approved in chat 2026-10-02 and in `.lavish/tabled-design-preview.html` (untracked). The design brief is restated under Global Constraints so this plan stands alone.

## Global Constraints

- Free services only: Gemini free tier, Vercel Hobby, no Plaid calls at runtime. The only env var is `GOOGLE_GENERATIVE_AI_API_KEY`.
- Every dollar figure on screen comes from `lib/matcher.ts`. Gemini output is prose only.
- Findings list is capped at 5, sorted by annual savings descending.
- Gemini summary and chat replies are 2 sentences max. The system prompt enforces it.
- Product name is **Tabled**. Wordmark, `<title>`, and copy use it.
- Design tokens (exact): paper `#F7F6F2`, surface `#FFFFFF`, ink `#141414`, ink-2 `#5F5E59`, ink-3 `#9A9893`, line `#E6E4DD`, line-strong `#D6D3CA`, accent `#0B6B4B`, accent-soft `#E3F1EA`, accent-ink `#075239`, warn `#B45309`, warn-soft `#FBEEDC`. Radius 12px cards, 10px buttons.
- Fonts: Inter Tight (display, numbers, tight tracking), Inter (body), JetBrains Mono (labels, sources). Tabular numerals on every number.
- Accent color is used only for savings figures and the Gemini summary card. Nothing else is colored.
- Monogram avatars for merchants. No scraped brand logos.
- Cut order if time runs out: Task 7 (landing), then Task 6 (chat), then motion in Task 4. Never cut Task 3 (matcher test).
- No README, no extra docs. `AGENTS.md` and `CLAUDE.md` already exist and are the only instruction files.

## Review Focus

1. A transaction name with different casing or a suffix (`SPOTIFY USA`, `Spotify*Premium`) must still match the Spotify catalog entry. Test in Task 3.
2. A persona with zero matches must render the dashboard with `$0`, an empty list, and a canned summary, not a crash. Test in Task 3 and Task 5.
3. Gemini key missing or API failing must leave the dashboard fully usable with a canned summary. Test manually in Task 5 by unsetting the key.
4. The hero count-up must land on the exact computed total, never a rounded intermediate. Verified in Task 4 by reading the final DOM text.
5. Chat must refuse numbers that aren't in the findings. Verified in Task 6 by asking "how much do I spend on Netflix" and expecting an "I don't see that" answer.

---

### Task 1: Scaffold and design tokens

**Files:**
- Create: whole Next.js app via CLI, then edit `app/globals.css`, `app/layout.tsx`
- Create: `package.json` scripts (`check`, `doctor`)

**Interfaces:**
- Produces: CSS custom properties and Tailwind theme tokens named `paper`, `surface`, `ink`, `ink-2`, `ink-3`, `line`, `line-strong`, `accent`, `accent-soft`, `accent-ink`, `warn`, `warn-soft`. Font variables `--font-display`, `--font-body`, `--font-mono`.

- [ ] **Step 1: Scaffold**

```bash
bunx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias "@/*" --use-bun --yes
bun add ai @ai-sdk/google @ai-sdk/react motion
bun add -d vitest
bunx shadcn@latest init -d --yes
bunx shadcn@latest add button input badge scroll-area --yes
```

- [ ] **Step 2: Tokens in `app/globals.css`** (replace the generated `:root` block, keep the Tailwind import and shadcn layer)

```css
@import "tailwindcss";

@theme inline {
  --color-paper: #F7F6F2;
  --color-surface: #FFFFFF;
  --color-ink: #141414;
  --color-ink-2: #5F5E59;
  --color-ink-3: #9A9893;
  --color-line: #E6E4DD;
  --color-line-strong: #D6D3CA;
  --color-accent: #0B6B4B;
  --color-accent-soft: #E3F1EA;
  --color-accent-ink: #075239;
  --color-warn: #B45309;
  --color-warn-soft: #FBEEDC;
  --font-display: var(--font-inter-tight);
  --font-body: var(--font-inter);
  --font-mono: var(--font-jetbrains);
}

body { @apply bg-paper text-ink font-body antialiased; }
.num { font-variant-numeric: tabular-nums; }
```

- [ ] **Step 3: Fonts in `app/layout.tsx`**

```tsx
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const interTight = Inter_Tight({ subsets: ["latin"], variable: "--font-inter-tight" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata = { title: "Tabled", description: "Money you're leaving on the table." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Scripts in `package.json`**

```json
"check": "bunx tsc --noEmit && bun run lint && bunx vitest run",
"doctor": "bun run scripts/doctor.ts"
```

- [ ] **Step 5: Verify** `bun run dev` serves the default page with no console errors. Then commit.

```bash
git add -A && git commit -m "feat: scaffold Tabled with design tokens"
```

---

### Task 2: Types, catalog, and persona

**Files:**
- Create: `lib/types.ts`, `lib/data/catalog.json`, `lib/data/persona.json`

**Interfaces:**
- Produces: `Transaction`, `CatalogEntry`, `Finding`, `SavingsReport` types. Two JSON files consumed by Task 3.

- [ ] **Step 1: `lib/types.ts`**

```ts
export type Transaction = {
  id: string;
  date: string;        // ISO date
  name: string;        // raw bank descriptor
  amount: number;      // positive = money out
  category: string;    // Plaid-style category label
};

export type CatalogEntry = {
  id: string;
  merchant: string;
  match: string[];     // lowercase substrings tested against the descriptor
  kind: "subscription" | "fee" | "campus";
  retail?: number;     // monthly retail price (subscription/fee)
  student?: number;    // monthly student price (subscription/fee)
  alternative?: string; // what replaces it (campus)
  eligibility: string;
  effort: string;      // e.g. "2 min", "One phone call"
  action: string;      // button label
  claimUrl: string;
};

export type Finding = {
  id: string;
  merchant: string;
  monogram: string;
  kind: CatalogEntry["kind"];
  charges: number;
  paidTotal: number;
  youPay: string;
  couldPay: string;
  annualSavings: number;
  periodSavings: number;
  eligibility: string;
  effort: string;
  action: string;
  claimUrl: string;
  meta: string;
};

export type SavingsReport = {
  findings: Finding[];
  annualTotal: number;
  periodTotal: number;
  scanned: number;
  monthsCovered: number;
};
```

- [ ] **Step 2: `lib/data/catalog.json`** — the five demo entries plus a few decoys that must not match.

```json
[
  { "id": "adobe", "merchant": "Adobe Creative Cloud", "match": ["adobe"], "kind": "subscription", "retail": 59.99, "student": 19.99, "eligibility": ".edu email", "effort": "2 min", "action": "Switch", "claimUrl": "https://www.adobe.com/creativecloud/buy/students.html" },
  { "id": "uber-davis", "merchant": "Uber to Davis Square", "match": ["uber"], "kind": "campus", "alternative": "Joey shuttle, free", "eligibility": "Tufts ID", "effort": "Check the schedule", "action": "Schedule", "claimUrl": "https://publicsafety.tufts.edu/transportation/" },
  { "id": "bofa-fee", "merchant": "Bank of America maintenance fee", "match": ["monthly maintenance", "maintenance fee"], "kind": "fee", "retail": 12, "student": 0, "eligibility": "Under 25, call to waive", "effort": "One phone call", "action": "Script", "claimUrl": "https://www.bankofamerica.com/deposits/bank-account-fees/" },
  { "id": "prime", "merchant": "Amazon Prime", "match": ["amazon prime", "prime membership"], "kind": "subscription", "retail": 14.99, "student": 7.49, "eligibility": "6 months free first", "effort": "2 min", "action": "Switch", "claimUrl": "https://www.amazon.com/primestudent" },
  { "id": "spotify", "merchant": "Spotify Premium", "match": ["spotify"], "kind": "subscription", "retail": 11.99, "student": 5.99, "eligibility": "Includes Hulu", "effort": "2 min", "action": "Switch", "claimUrl": "https://www.spotify.com/us/student/" },
  { "id": "youtube", "merchant": "YouTube Premium", "match": ["youtube"], "kind": "subscription", "retail": 13.99, "student": 7.99, "eligibility": ".edu email", "effort": "2 min", "action": "Switch", "claimUrl": "https://www.youtube.com/premium/student" },
  { "id": "apple-music", "merchant": "Apple Music", "match": ["apple.com/bill", "apple music"], "kind": "subscription", "retail": 10.99, "student": 5.99, "eligibility": ".edu email", "effort": "2 min", "action": "Switch", "claimUrl": "https://support.apple.com/en-us/105107" }
]
```

- [ ] **Step 3: `lib/data/persona.json`** — Maya, Tufts '27, 3 months (Sep 1 to Nov 30, 2026). Write ~60 transactions. The ones that must exist, with exact descriptors:

```json
{
  "name": "Maya",
  "school": "Tufts '27",
  "account": "Bank of America ••4821",
  "monthsCovered": 3,
  "transactions": [
    { "id": "t1", "date": "2026-09-03", "name": "MONTHLY MAINTENANCE FEE", "amount": 12, "category": "Bank Fees" },
    { "id": "t2", "date": "2026-10-03", "name": "MONTHLY MAINTENANCE FEE", "amount": 12, "category": "Bank Fees" },
    { "id": "t3", "date": "2026-11-03", "name": "MONTHLY MAINTENANCE FEE", "amount": 12, "category": "Bank Fees" },
    { "id": "t4", "date": "2026-09-05", "name": "ADOBE *CREATIVE CLOUD", "amount": 59.99, "category": "Software" },
    { "id": "t5", "date": "2026-10-05", "name": "ADOBE *CREATIVE CLOUD", "amount": 59.99, "category": "Software" },
    { "id": "t6", "date": "2026-11-05", "name": "ADOBE *CREATIVE CLOUD", "amount": 59.99, "category": "Software" },
    { "id": "t7", "date": "2026-09-11", "name": "AMAZON PRIME MEMBERSHIP", "amount": 14.99, "category": "Subscription" },
    { "id": "t8", "date": "2026-10-11", "name": "AMAZON PRIME MEMBERSHIP", "amount": 14.99, "category": "Subscription" },
    { "id": "t9", "date": "2026-11-11", "name": "AMAZON PRIME MEMBERSHIP", "amount": 14.99, "category": "Subscription" },
    { "id": "t10", "date": "2026-09-14", "name": "Spotify USA", "amount": 11.99, "category": "Subscription" },
    { "id": "t11", "date": "2026-10-14", "name": "Spotify USA", "amount": 11.99, "category": "Subscription" },
    { "id": "t12", "date": "2026-11-14", "name": "Spotify USA", "amount": 11.99, "category": "Subscription" }
  ]
}
```

Add 9 Uber rides summing to exactly `97.00` (e.g. 10.80, 11.20, 9.90, 12.40, 10.10, 11.60, 10.30, 9.70, 11.00) with descriptor `UBER *TRIP` and category `Travel`. Then fill the rest with non-matching noise: `DUNKIN #3391`, `TUFTS DINING`, `CVS PHARMACY`, `TRADER JOES`, `MBTA CHARLIECARD`, `DOORDASH*CHIPOTLE`, `VENMO PAYMENT`, `AMAZON MKTPL*` (plain Amazon orders must NOT match Prime, which is why the Prime match strings are specific).

- [ ] **Step 4: Commit**

```bash
git add lib && git commit -m "feat: types, discount catalog, demo persona"
```

---

### Task 3: Matcher with tests

**Files:**
- Create: `lib/matcher.ts`, `lib/matcher.test.ts`, `vitest.config.ts`

**Interfaces:**
- Consumes: types and JSON from Task 2.
- Produces: `findSavings(transactions: Transaction[], catalog: CatalogEntry[], monthsCovered: number): SavingsReport` and `money(n: number): string`.

- [ ] **Step 1: `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["lib/**/*.test.ts"] } });
```

- [ ] **Step 2: Failing tests in `lib/matcher.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { findSavings } from "./matcher";
import catalog from "./data/catalog.json";
import persona from "./data/persona.json";
import type { CatalogEntry, Transaction } from "./types";

const cat = catalog as CatalogEntry[];
const txns = persona.transactions as Transaction[];

describe("findSavings", () => {
  it("finds the five demo savings in order with the right annual total", () => {
    const r = findSavings(txns, cat, persona.monthsCovered);
    expect(r.findings.map((f) => f.id)).toEqual(["adobe", "uber-davis", "bofa-fee", "prime", "spotify"]);
    expect(r.annualTotal).toBe(1174);
    expect(r.scanned).toBe(txns.length);
  });

  it("matches descriptors regardless of case and suffix", () => {
    const r = findSavings([{ id: "x", date: "2026-09-01", name: "SPOTIFY*PREMIUM 1234", amount: 11.99, category: "Subscription" }], cat, 1);
    expect(r.findings[0]?.id).toBe("spotify");
  });

  it("does not match plain Amazon orders to Prime", () => {
    const r = findSavings([{ id: "x", date: "2026-09-01", name: "AMAZON MKTPL*2K3J", amount: 23.4, category: "Shopping" }], cat, 1);
    expect(r.findings).toHaveLength(0);
  });

  it("caps at five findings", () => {
    const many = cat.filter((c) => c.kind === "subscription").map((c, i) => ({ id: String(i), date: "2026-09-01", name: c.match[0], amount: c.retail ?? 0, category: "Subscription" }));
    const r = findSavings(many, cat, 1);
    expect(r.findings.length).toBeLessThanOrEqual(5);
  });

  it("returns an empty report for no matches", () => {
    const r = findSavings([{ id: "x", date: "2026-09-01", name: "DUNKIN #1", amount: 4, category: "Food" }], cat, 1);
    expect(r).toMatchObject({ findings: [], annualTotal: 0, periodTotal: 0, scanned: 1 });
  });
});
```

- [ ] **Step 3: Run to verify failure** — `bunx vitest run` → FAIL, module `./matcher` not found.

- [ ] **Step 4: `lib/matcher.ts`**

```ts
import type { CatalogEntry, Finding, SavingsReport, Transaction } from "./types";

export function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Number.isInteger(n) ? 0 : 2 });
}

const monogram = (s: string) => s.replace(/[^A-Za-z]/g, "").slice(0, 2);

export function findSavings(transactions: Transaction[], catalog: CatalogEntry[], monthsCovered: number): SavingsReport {
  const findings: Finding[] = [];

  for (const entry of catalog) {
    const hits = transactions.filter((t) => {
      const n = t.name.toLowerCase();
      return entry.match.some((m) => n.includes(m));
    });
    if (hits.length === 0) continue;

    const paidTotal = round2(hits.reduce((s, t) => s + t.amount, 0));

    if (entry.kind === "campus") {
      const annual = Math.round((paidTotal / monthsCovered) * 12);
      findings.push({
        id: entry.id, merchant: entry.merchant, monogram: monogram(entry.merchant), kind: entry.kind,
        charges: hits.length, paidTotal,
        youPay: `${money(paidTotal)} /sem`, couldPay: entry.alternative ?? "",
        annualSavings: annual, periodSavings: paidTotal,
        eligibility: entry.eligibility, effort: entry.effort, action: entry.action, claimUrl: entry.claimUrl,
        meta: `${hits.length} ${hits.length === 1 ? "ride" : "rides"} this semester`,
      });
      continue;
    }

    const retail = entry.retail ?? 0;
    const student = entry.student ?? 0;
    const delta = retail - student;
    findings.push({
      id: entry.id, merchant: entry.merchant, monogram: monogram(entry.merchant), kind: entry.kind,
      charges: hits.length, paidTotal,
      youPay: `${money(retail)} /mo`, couldPay: `${money(student)} /mo`,
      annualSavings: Math.round(delta * 12), periodSavings: round2(delta * hits.length),
      eligibility: entry.eligibility, effort: entry.effort, action: entry.action, claimUrl: entry.claimUrl,
      meta: `${hits.length} ${hits.length === 1 ? "charge" : "charges"} since ${monthName(hits[0].date)}`,
    });
  }

  findings.sort((a, b) => b.annualSavings - a.annualSavings);
  const top = findings.slice(0, 5);

  return {
    findings: top,
    annualTotal: top.reduce((s, f) => s + f.annualSavings, 0),
    periodTotal: round2(top.reduce((s, f) => s + f.periodSavings, 0)),
    scanned: transactions.length,
    monthsCovered,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const monthName = (iso: string) => new Date(iso + "T00:00:00").toLocaleString("en-US", { month: "short" });
```

- [ ] **Step 5: Run tests** — `bunx vitest run` → 5 passed. If the first test fails on order or total, fix the persona data, not the matcher.

- [ ] **Step 6: Commit**

```bash
git add lib vitest.config.ts && git commit -m "feat: deterministic savings matcher with tests"
```

---

### Task 4: Dashboard page, hero, findings list

**Files:**
- Create: `app/dashboard/page.tsx`, `components/nav.tsx`, `components/hero.tsx`, `components/findings-list.tsx`
- Modify: `app/page.tsx` (temporary redirect to `/dashboard` until Task 7)

**Interfaces:**
- Consumes: `findSavings`, `money`, `SavingsReport`, `Finding`.
- Produces: `<Hero report={report} />`, `<FindingsList findings={report.findings} />`, `<Nav persona={{name, school, account}} />`. The page passes `report` to Task 5 and Task 6 components as a prop.

- [ ] **Step 1: `app/page.tsx`** — until the landing exists: `import { redirect } from "next/navigation"; export default function Page() { redirect("/dashboard"); }`

- [ ] **Step 2: `app/dashboard/page.tsx`** (server component)

```tsx
import catalog from "@/lib/data/catalog.json";
import persona from "@/lib/data/persona.json";
import { findSavings } from "@/lib/matcher";
import type { CatalogEntry, Transaction } from "@/lib/types";
import { Nav } from "@/components/nav";
import { Hero } from "@/components/hero";
import { FindingsList } from "@/components/findings-list";
import { SummaryCard } from "@/components/summary-card";
import { ChatRail } from "@/components/chat-rail";

export default function Dashboard() {
  const report = findSavings(persona.transactions as Transaction[], catalog as CatalogEntry[], persona.monthsCovered);
  return (
    <div className="min-h-dvh bg-surface">
      <Nav persona={persona} />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <main className="px-8 py-9 lg:border-r border-line">
          <Hero report={report} />
          <SummaryCard report={report} />
          <FindingsList findings={report.findings} />
        </main>
        <ChatRail report={report} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `components/hero.tsx`** (client, count-up with `motion`)

```tsx
"use client";
import { useEffect, useRef } from "react";
import { animate } from "motion";
import type { SavingsReport } from "@/lib/types";
import { money } from "@/lib/matcher";

export function Hero({ report }: { report: SavingsReport }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { el.textContent = money(report.annualTotal); return; }
    const controls = animate(0, report.annualTotal, {
      duration: 0.9, ease: "easeOut",
      onUpdate: (v) => { el.textContent = money(Math.round(v)); },
      onComplete: () => { el.textContent = money(report.annualTotal); },
    });
    return () => controls.stop();
  }, [report.annualTotal]);

  const quick = report.findings.filter((f) => f.effort === "2 min").length;
  return (
    <section className="grid gap-6 border-b border-line pb-7 mb-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
      <div>
        <p className="text-ink-2 mb-1.5">Money you're leaving on the table</p>
        <p className="font-display font-semibold tracking-[-0.045em] leading-none text-[clamp(56px,7vw,84px)] num">
          <span ref={ref}>{money(report.annualTotal)}</span>
          <span className="ml-1.5 text-[0.42em] font-medium tracking-[-0.02em] text-ink-3">/ year</span>
        </p>
        <p className="mt-2.5 text-ink-2"><b className="text-ink font-semibold">{report.findings.length} things to fix.</b> {quick} take under two minutes.</p>
      </div>
      <dl className="flex gap-7">
        <div><dt className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-3">This semester</dt><dd className="font-display text-[22px] font-semibold tracking-tight num">{money(report.periodTotal)}</dd></div>
        <div><dt className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-3">Scanned</dt><dd className="font-display text-[22px] font-semibold tracking-tight num">{report.scanned} charges</dd></div>
      </dl>
    </section>
  );
}
```

- [ ] **Step 4: `components/findings-list.tsx`** (client, stagger with `motion/react`). Row grid: `40px minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) auto auto`. Monogram box, name + meta, "You pay" column, "Student price" or "Alternative" column with eligibility `Badge`, annual savings in `text-accent font-display font-semibold` with a mono `/ YEAR` sub-label, and a shadcn `Button variant="outline" size="sm"` linking to `claimUrl` with `action` as the label. Wrap rows in `motion.div` with `initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}`. Header row above the list: "What to fix" plus three filter chips (All / Subscriptions / Campus / Fees) that filter by `kind` in local state.

- [ ] **Step 5: `components/nav.tsx`** — wordmark (22px ink rounded square with a paper line through it, then "Tabled" in `font-display font-semibold`), persona on the right: 28px gradient avatar circle, then `Maya · Tufts '27 · Bank of America ••4821` in `text-[13px] text-ink-2`.

- [ ] **Step 6: Verify** — `bun run dev`, open `/dashboard`. Hero lands on exactly `$1,174`. Five rows, Adobe first. Resize to 390px: rail stacks under main, no horizontal scroll. `bun run check` passes. Commit.

```bash
git add -A && git commit -m "feat: dashboard with hero count-up and findings list"
```

---

### Task 5: Gemini summary (streamed, with canned fallback)

**Files:**
- Create: `lib/prompt.ts`, `app/api/summary/route.ts`, `components/summary-card.tsx`, `.env.local` (gitignored), `.env.example`

**Interfaces:**
- Consumes: `SavingsReport`.
- Produces: `systemPrompt(report: SavingsReport): string` and `fallbackSummary(report): string` used by Task 6 too. `POST /api/summary` with body `{ report }` returns a text stream.

- [ ] **Step 1: `.env.example`** with `GOOGLE_GENERATIVE_AI_API_KEY=` and the same key filled in `.env.local`.

- [ ] **Step 2: `lib/prompt.ts`**

```ts
import type { SavingsReport } from "./types";
import { money } from "./matcher";

export function systemPrompt(report: SavingsReport): string {
  return `You are Tabled, a money coach for college students. Blunt, warm, zero jargon, no moralizing about spending.
Hard rules:
- Two sentences maximum, always.
- Every dollar figure and merchant you mention must appear in FINDINGS below. Never invent a price, discount, or merchant.
- If asked about something not in FINDINGS, say you don't see it in their transactions.
- Lead with the biggest annual saving when summarizing.

FINDINGS (computed from the student's bank transactions, trustworthy):
${JSON.stringify(report.findings.map((f) => ({ merchant: f.merchant, youPay: f.youPay, couldPay: f.couldPay, annualSavings: f.annualSavings, charges: f.charges, eligibility: f.eligibility, effort: f.effort })), null, 2)}
ANNUAL TOTAL: ${money(report.annualTotal)}`;
}

export function fallbackSummary(report: SavingsReport): string {
  const top = report.findings[0];
  if (!top) return "Nothing to fix. Every charge we scanned is already at the best price we know of.";
  return `${top.merchant} is the big one: ${top.youPay} when students pay ${top.couldPay}, which is ${money(top.annualSavings)} a year. Fix that today and the rest are quick swaps.`;
}
```

- [ ] **Step 3: `app/api/summary/route.ts`** — check `node_modules/ai/docs` for the installed version's `streamText` and text-stream response helper before writing; the shape below is the intent.

```ts
import { google } from "@ai-sdk/google";
import { streamText } from "ai";
import { systemPrompt } from "@/lib/prompt";
import type { SavingsReport } from "@/lib/types";

export async function POST(req: Request) {
  const { report } = (await req.json()) as { report: SavingsReport };
  const result = streamText({
    model: google("gemini-2.5-flash"),
    system: systemPrompt(report),
    prompt: "Write the dashboard summary. Two sentences. Lead with the biggest number.",
  });
  return result.toTextStreamResponse();
}
```

- [ ] **Step 4: `components/summary-card.tsx`** (client). On mount, `fetch("/api/summary", { method: "POST", body: JSON.stringify({ report }) })`, read the stream with `TextDecoder`, append to state. On non-OK or thrown error, set text to `fallbackSummary(report)`. Render: `bg-accent-soft border border-accent/20 rounded-xl p-4 grid grid-cols-[auto_minmax(0,1fr)] gap-3`, a 18px sparkle SVG in `text-accent`, text in `text-accent-ink`, and a footer line in `font-mono text-[11px] text-accent/80` reading `EXPLAINED BY GEMINI · NUMBERS FROM YOUR TRANSACTIONS` (or `· OFFLINE SUMMARY` when fallback fired).

- [ ] **Step 5: Verify** — summary streams in, mentions Adobe and $480, two sentences. Then `GOOGLE_GENERATIVE_AI_API_KEY=bad bun run dev` → card shows the fallback, page still works. Commit.

```bash
git add -A && git commit -m "feat: streamed Gemini summary with offline fallback"
```

---

### Task 6: Chat rail

**Files:**
- Create: `app/api/chat/route.ts`, `components/chat-rail.tsx`

**Interfaces:**
- Consumes: `systemPrompt`, `SavingsReport`.
- Produces: `POST /api/chat` with `{ messages, report }`, UI-message stream for `useChat`.

- [ ] **Step 1: `app/api/chat/route.ts`** — verify `convertToModelMessages` and `toUIMessageStreamResponse` names against `node_modules/ai/docs` first.

```ts
import { google } from "@ai-sdk/google";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { systemPrompt } from "@/lib/prompt";
import type { SavingsReport } from "@/lib/types";

export async function POST(req: Request) {
  const { messages, report } = (await req.json()) as { messages: UIMessage[]; report: SavingsReport };
  const result = streamText({
    model: google("gemini-2.5-flash"),
    system: systemPrompt(report),
    messages: await convertToModelMessages(messages),
  });
  return result.toUIMessageStreamResponse();
}
```

- [ ] **Step 2: `components/chat-rail.tsx`** (client). `useChat` from `@ai-sdk/react` with a `DefaultChatTransport({ api: "/api/chat", body: { report } })`. Layout: `<aside className="flex flex-col bg-[#FBFAF7] min-h-[560px]">`, header "Ask about your money" with `GEMINI FLASH` mono label, `ScrollArea` of messages (user bubbles `bg-ink text-white rounded-[14px_14px_4px_14px]`, assistant bubbles `bg-surface border border-line rounded-[14px_14px_14px_4px]`), three suggestion chips that submit preset questions (`What expires soonest?`, `Write the bank fee script`, `Total if I fix everything?`), and a composer: `Input` plus a 32px ink send button with an arrow SVG. Disable send while streaming.

- [ ] **Step 3: Verify** — ask "is prime student worth it?" → answer cites $14.99 and $7.49 or $90. Ask "how much do I spend on Netflix?" → answer says it doesn't see Netflix. `bun run check` passes. Commit.

```bash
git add -A && git commit -m "feat: chat rail grounded in findings"
```

---

### Task 7: Landing screen (cut first)

**Files:**
- Modify: `app/page.tsx` (replace redirect)

- [ ] **Step 1: Landing** — centered, max-w 560px. Pill `FREE FOR STUDENTS` with a 6px accent dot. H1 in `font-display font-semibold tracking-[-0.035em] text-[clamp(36px,5vw,52px)]`: `Stop paying` line break `full price.` with "full price" in `text-accent`. One line: `We scan your bank for student discounts you're not using.` Two buttons: primary ink `Connect your bank` (card SVG icon) and outline `Try the demo account`. Both `href="/dashboard"`. Fine print in mono 12px ink-3: `READ-ONLY · POWERED BY PLAID · WE NEVER MOVE MONEY`. Add a 600ms fake "Connecting…" state on the primary button before navigating so the demo has a beat.

- [ ] **Step 2: Verify and commit** — `git commit -am "feat: landing screen"`.

---

### Task 8: Doctor script and deploy

**Files:**
- Create: `scripts/doctor.ts`

- [ ] **Step 1: `scripts/doctor.ts`**

```ts
import catalog from "../lib/data/catalog.json";
import persona from "../lib/data/persona.json";
import { findSavings } from "../lib/matcher";
import type { CatalogEntry, Transaction } from "../lib/types";

const fail = (m: string) => { console.error("✗ " + m); process.exitCode = 1; };
const ok = (m: string) => console.log("✓ " + m);

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) fail("GOOGLE_GENERATIVE_AI_API_KEY missing (.env.local)"); else ok("Gemini key present");

const r = findSavings(persona.transactions as Transaction[], catalog as CatalogEntry[], persona.monthsCovered);
if (r.annualTotal <= 0) fail("matcher produced $0; persona or catalog broke"); else ok(`matcher: ${r.findings.length} findings, $${r.annualTotal}/yr`);
if (r.findings.length > 5) fail("more than five findings");

const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + process.env.GOOGLE_GENERATIVE_AI_API_KEY);
if (!res.ok) fail(`Gemini API unreachable (${res.status})`); else ok("Gemini API reachable");
```

Run with `bun --env-file=.env.local run scripts/doctor.ts` (set the `doctor` script to that).

- [ ] **Step 2: Deploy** — `vercel link --yes`, `vercel env add GOOGLE_GENERATIVE_AI_API_KEY production` (paste key), `vercel --prod --yes`. Open the production URL, confirm the hero shows `$1,174` and the summary streams. A local build passing is not proof. Commit the doctor script.

```bash
git add scripts package.json && git commit -m "chore: doctor script"
```

---

## Self-review notes

- Spec coverage: tokens (T1), data (T2), matcher + 5-cap + case-insensitive (T3), hero count-up + stagger + five rows + filters (T4), two-sentence Gemini summary with fallback (T5), chat grounded in findings (T6), landing (T7), doctor + live URL (T8). Accent-only-for-savings is enforced by the component classes in T4 and T5.
- Type consistency: `findSavings(transactions, catalog, monthsCovered)` and `money(n)` are used identically in T3, T4, T5, T8. `systemPrompt(report)` and `fallbackSummary(report)` in T5 and T6.
- AI SDK API names in T5 and T6 are flagged for verification against the installed docs because the major version at install time may differ.
