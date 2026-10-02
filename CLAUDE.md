# Claude Code notes

Read `AGENTS.md` first. It holds the product rules, stack, repo structure, and working rules. This file only adds what's specific to Claude Code.

For the newly supplied cash-flow backend, read the **Cash-flow backend handoff for the UI** section below before starting UI integration. The plan-execution notes below describe the earlier discount-finder workflow.

- Execute `.claude/plans/2026-10-02-tabled-build-plan.md` with the `superpowers:subagent-driven-development` skill, task by task, in order.
- Use `superpowers:test-driven-development` for `lib/matcher.ts`. It is the one file that must have tests.
- Use `superpowers:verification-before-completion` before saying any task is done. Show the command output.
- Use `superpowers:systematic-debugging` on the first failure. Three failed attempts at the same thing means stop and report.
- For UI work, follow the tokens in `AGENTS.md`. Do not invent new colors, fonts, or radii.
- Deploy with the `vercel:deploy` skill and check the production URL in a browser before reporting.

## Cash-flow backend handoff for the UI (2026-10-02)

The user supplied a cash-flow decision concept and requested this backend so their teammate can build its UI. Build the cash-flow screen around the API below. The earlier plan documents a different discount-finder workflow; keep this addition scoped to cash flow and preserve any frontend work already in progress. The hackathon deliverable is a concept demo supporting a two-minute pitch, not a production banking product.

### What exists

- `lib/cashflow.mjs`: pure, validated, cent-based calculations. Takes an explicit balance, upcoming bills, expected next income date, essentials allowance/history, protected buffer, optional savings reserve, and proposed purchase. Produces a forecast ending the day before the next income.
- `lib/cashflow-api.mjs`: shared HTTP handlers, JSON input validation, a 256 KB body limit, and JSON errors.
- `lib/data/cashflow-demo.json`: Maya's sample profile, 25 historical transactions, and a suggested $180 concert ticket. Dates are a fixed demo scenario, not today's live data.
- `app/api/cashflow/demo/route.js` and `app/api/cashflow/assess/route.js`: Next.js App Router endpoints. They select the Node runtime.
- `lib/cashflow-client.ts`: browser-safe typed helpers, `loadDemo()` and `assessPurchase()`, plus exported profile, transaction, purchase, response, and error types. Import this file in the UI; it does not import the server calculator.
- `scripts/cashflow-server.mjs`: optional standalone local HTTP server on `http://127.0.0.1:3001` with CORS. Not needed when running inside Next.js.
- `cashflow.http`: ready-to-run sample requests, including a custom profile.
- `tests/cashflow.test.mjs`: 17 passing Node tests, including HTTP, typed-client integration, and the route exports.

### API contract

`GET /api/cashflow/demo` returns `{ isDemo: true, profile, transactions, suggestedPurchase, preview }`. Use `preview` for the initial cards and chart. `preview` contains the same calculator fields as a POST assessment except its top-level `isDemo` field.

`POST /api/cashflow/assess` requires `Content-Type: application/json` and this minimal body:

```json
{
  "purchase": { "label": "Concert ticket", "amount": 180 }
}
```

Omit `profile` and `transactions` together to use the demo student. To assess uploaded JSON data, send `{ profile, transactions, purchase }` with a complete profile; custom profiles are never merged with the sample data. An optional `purchase.date` must be on or after `profile.asOf` and before the next income date; omitting it means purchase on `asOf`.

A profile needs `name`, `currency: "USD"`, `asOf`, `currentBalance`, `minimumBuffer`, `nextIncome: { date, amount }`, and `upcomingBills: [{ id, label, date, amount }]`. Optional `savingsReserve` protects money already included in the balance. For everyday expenses, either supply `dailyEssentials` or supply `historyStart` and historical transactions tagged `essential`. Transactions need `id`, `date`, `name`, a positive-dollar `amount`, and `kind: "essential" | "discretionary" | "bill" | "income"`. The estimator uses the entire history window, including days with no transactions. This is structured JSON input; CSV parsing and free-text question interpretation are not implemented.

Amounts in responses are numeric dollars. The assessment fields useful for UI are:

| Field | Display/use |
| --- | --- |
| `decision` | `comfortable`, `buffer_risk`, or `shortfall` |
| `safeToSpend` | Largest purchase that preserves the protected reserve |
| `currentBalance` | Opening available balance |
| `totalUpcomingBills` | Bills falling before the next income date |
| `estimatedEssentials` | Estimated everyday expenses across the forecast |
| `minimumBuffer`, `savingsReserve`, `protectedReserve` | Protected money and its components |
| `lowestProjectedBalance`, `lowestBalanceDate` | Lowest balance after the proposed purchase |
| `amountOverSafeLimit` | How far the purchase exceeds the spending limit |
| `explanation` | Two sentences, ready to render |
| `timeline` | Each day's `date`, `baselineBalance`, `projectedBalance`, `bills`, `essentials`, and `purchase` for a chart/breakdown |
| `assumptions` | Calculation assumptions for a short expandable details panel |
| `nextIncome`, `horizon` | Payday and forecast date range |

The forecast excludes the next paycheck and expenses on that paycheck date. Historical transactions are already reflected in the supplied balance; they are not subtracted again. Past-due unpaid bills must be moved to `asOf` explicitly. Estimates use daily expenses and known bills; irregular income changes require updating the profile and recalculating. Do not present `safeToSpend` as a bank guarantee or claim a live account connection.

HTTP errors use `{ error: { code, message } }`: 400 for invalid inputs, 413 for excessive body size, 415 for missing/incorrect JSON content type, and 500 for an unexpected calculation error. The typed client throws `CashflowApiError`; catch it and display its message. Keep the last valid forecast visible while handling errors.

### Suggested minimal UI

1. Load the demo on mount and show a visible "Demo account" label, current balance, next income date, and spending limit. Prefill "Concert ticket" and `180` from `suggestedPurchase`.
2. Let the student edit the proposed item and amount, then click "Can I afford it?". Call `assessPurchase({ purchase: { label, amount } })` in sample mode.
3. Display the decision and `explanation`, with a breakdown of balance minus bills minus essentials minus reserve. Use the returned amounts rather than duplicating the engine in the browser.
4. Plot `timeline.date` against `baselineBalance` and `projectedBalance`; a horizontal `protectedReserve` reference makes the tradeoff visible. A simple daily balance list also works.
5. Offer "Try $110 instead" using the returned `safeToSpend` value, not a hardcoded UI amount. Reassess it to show the outcome change. Disable submit while the request runs and provide loading/error states.
6. If adding profile edits or JSON upload, send the edited profile and transactions on every assessment; calling the minimal demo body discards custom inputs.

```ts
import { loadDemo, assessPurchase } from "@/lib/cashflow-client";

const demo = await loadDemo();
const result = await assessPurchase({ purchase: demo.suggestedPurchase });
// result.safeToSpend === 110
// result.decision === "buffer_risk"
// result.lowestProjectedBalance === 30

const revised = await assessPurchase({
  purchase: { label: demo.suggestedPurchase.label, amount: result.safeToSpend },
});
// revised.decision === "comfortable"
// revised.lowestProjectedBalance === 100
```

Use the existing Inter/Inter Tight/JetBrains Mono typography and design tokens. The cash-flow engine already supplies the explanation; no Gemini call is required. If adding LLM phrasing later, ground it in these returned fields and keep the deterministic explanation as fallback.

### Run and verify

Standalone, with Node 24:

```sh
node scripts/cashflow-server.mjs
node --test tests/cashflow.test.mjs
```

For a separate frontend, pass `"http://127.0.0.1:3001"` as the helpers' second argument. Inside Next.js, leave the base URL empty and run the normal application server; there is no extra backend process or package to install.

GitHub had no Next.js scaffold, package.json, frontend, or installed dependencies when this backend was added. Node tests verified the engine, actual HTTP requests, frontend helper, and direct route exports; a full Next.js build and browser integration have not been verified. Scaffold without overwriting the existing `app/api/cashflow` or `lib/cashflow*` files, then run the application's type/lint checks and exercise the endpoints. If using a `src/` layout, keep the app/lib relative placement consistent. Do not say the full UI or deployment is done until it has been checked.
