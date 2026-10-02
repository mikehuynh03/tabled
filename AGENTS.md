# Tabled

Hackathon prototype: reads a student's bank transactions, matches them against a student-discount catalog, and shows "money you're leaving on the table" with five fixes, a Gemini summary, and a chat rail.

Plan: `.claude/plans/2026-10-02-tabled-build-plan.md`. Build it in task order. If time runs out, cut from the end.

## Non-negotiables

- Every dollar figure on screen comes from `lib/matcher.ts`. Gemini writes prose only and must never invent a number or merchant.
- Findings are capped at five, biggest annual saving first.
- Gemini output is two sentences max. The system prompt in `lib/prompt.ts` enforces it; don't loosen it.
- Free services only. Gemini free tier, Vercel Hobby. No Plaid calls at runtime. The only secret is `GOOGLE_GENERATIVE_AI_API_KEY`.
- No database, no auth, no new infrastructure. Demo data lives in `lib/data/`.
- The dashboard must render fully if Gemini is down. Use `fallbackSummary`.

## Stack

Next.js App Router, TypeScript, Tailwind v4, shadcn/ui, `motion`, AI SDK with `@ai-sdk/google`, vitest, Bun.

Before using an AI SDK API, check `node_modules/ai/docs` for the installed version. Don't code from memory.

## Repo structure

```
app/
  layout.tsx            fonts + globals
  page.tsx              landing (cut first)
  dashboard/page.tsx    server component, runs the matcher
  api/summary/route.ts  streams the two-sentence summary
  api/chat/route.ts     streams chat grounded in findings
components/             one component per file, named exports
  ui/                   shadcn, don't hand-edit
lib/
  types.ts              Transaction, CatalogEntry, Finding, SavingsReport
  matcher.ts            findSavings(), money()  — the only source of numbers
  matcher.test.ts
  prompt.ts             systemPrompt(), fallbackSummary()
  data/catalog.json     student discounts, hand-curated
  data/persona.json     Maya, Tufts '27, 3 months of transactions
scripts/doctor.ts       env + matcher + Gemini reachability
```

## Design

Tokens are defined once in `app/globals.css` and nowhere else. Accent green is reserved for savings figures and the Gemini card. Fonts: Inter Tight for display and numbers (tabular), Inter for body, JetBrains Mono for labels. Monogram avatars, no brand logos. No emoji icons.

## Working rules

- Smallest change that works. No refactors of neighbors, no abstractions for hypothetical needs.
- Comments only for non-obvious *why*.
- Verify before claiming done: `bun run check` (types, lint, tests) and `bun run doctor`. For a deploy, the live Vercel URL is the proof, not a local build.
- Don't add README or summary docs. This file and the plan are the documentation.
- Don't push, force-push, or run destructive git commands without being asked.
