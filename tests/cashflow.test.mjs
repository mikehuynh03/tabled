import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import demo from '../lib/data/cashflow-demo.json' with { type: 'json' };
import { assessCashflow, InputError } from '../lib/cashflow.mjs';
import { getDemo, postAssessment } from '../lib/cashflow-api.mjs';
import { createCashflowServer } from '../scripts/cashflow-server.mjs';
import { assessPurchase, loadDemo, CashflowApiError } from '../lib/cashflow-client.ts';

const input = (amount = 180) => ({ ...structuredClone(demo), purchase: { label: 'Concert ticket', amount } });
const request = (value, headers = { 'Content-Type': 'application/json' }) => new Request('http://localhost/api/cashflow/assess', { method: 'POST', headers, body: JSON.stringify(value) });

test('the demo produces $110 available, $30 left after a $180 concert, and 14 daily points', () => {
  const result = assessCashflow(input());
  assert.equal(result.safeToSpend, 110);
  assert.equal(result.decision, 'buffer_risk');
  assert.equal(result.lowestProjectedBalance, 30);
  assert.equal(result.amountOverSafeLimit, 70);
  assert.equal(result.totalUpcomingBills, 550);
  assert.equal(result.estimatedEssentials, 140);
  assert.equal(result.essentialsSource, 'transaction_history');
  assert.equal(result.timeline.length, 14);
  assert.equal(result.timeline.at(-1).date, '2026-10-15');
  assert.match(result.explanation, /\$110/);
});

test('the exact limit preserves the reserve and one cent over is a buffer risk', () => {
  assert.equal(assessCashflow(input(110)).decision, 'comfortable');
  assert.equal(assessCashflow(input(110)).lowestProjectedBalance, 100);
  assert.equal(assessCashflow(input(110.01)).decision, 'buffer_risk');
});

test('overspending exposes an actual shortfall rather than approving against the balance', () => {
  const result = assessCashflow(input(250));
  assert.equal(result.decision, 'shortfall');
  assert.equal(result.lowestProjectedBalance, -40);
});

test('the next paycheck is not available before payday', () => {
  const data = input();
  data.profile.nextIncome.amount = 100_000;
  assert.equal(assessCashflow(data).safeToSpend, 110);
  data.profile.nextIncome.date = '2026-10-20';
  assert.equal(assessCashflow(data).safeToSpend, 70);
});

test('savings reserve further reduces available spending', () => {
  const data = input();
  data.profile.savingsReserve = 50;
  assert.equal(assessCashflow(data).safeToSpend, 60);
  assert.equal(assessCashflow(data).protectedReserve, 150);
});

test('historical income and bills are not counted again', () => {
  const data = input();
  data.transactions.find(t => t.kind === 'income').amount = 1_000_000;
  data.transactions.find(t => t.kind === 'bill').amount = 1_000_000;
  assert.equal(assessCashflow(data).safeToSpend, 110);
});

test('uses the full history window rather than only days containing transactions', () => {
  const data = input();
  data.transactions = [{ id: 'one', date: '2026-09-18', name: 'Groceries', kind: 'essential', amount: 140 }];
  assert.equal(assessCashflow(data).dailyEssentials, 10);
});

test('custom profiles can use an explicit everyday allowance without transaction history', () => {
  const data = input();
  delete data.transactions;
  delete data.profile.historyStart;
  data.profile.dailyEssentials = 5;
  assert.equal(assessCashflow(data).safeToSpend, 180);
  assert.equal(assessCashflow(data).decision, 'comfortable');
});

test('future purchases are deducted on the selected date', () => {
  const data = input();
  data.purchase.date = '2026-10-10';
  const result = assessCashflow(data);
  assert.equal(result.timeline[0].purchase, 0);
  assert.equal(result.timeline.find(day => day.date === '2026-10-10').purchase, 180);
  assert.equal(result.timeline.at(-1).projectedBalance, 30);
});

test('bills on asOf are counted, while bills on payday are outside the horizon', () => {
  const data = input();
  data.profile.upcomingBills.push({ id: 'today', label: 'Today', date: '2026-10-02', amount: 10 });
  data.profile.upcomingBills.push({ id: 'later', label: 'Later', date: '2026-10-16', amount: 500 });
  assert.equal(assessCashflow(data).safeToSpend, 100);
});

test('existing reserve breaches and negative balances are explained even for a zero purchase', () => {
  const data = input(0);
  data.profile.currentBalance = 700;
  let result = assessCashflow(data);
  assert.equal(result.safeToSpend, 0);
  assert.equal(result.decision, 'buffer_risk');
  assert.match(result.explanation, /Even without this purchase/);
  data.profile.currentBalance = -10;
  result = assessCashflow(data);
  assert.equal(result.decision, 'shortfall');
  assert.match(result.explanation, /already has a shortfall/);
});

test('invalid amounts, dates, duplicates, and missing estimation data are rejected', () => {
  const cases = [
    data => { data.purchase.amount = -1; },
    data => { data.purchase.amount = '180'; },
    data => { data.purchase.amount = 0.001; },
    data => { data.purchase.amount = Infinity; },
    data => { data.purchase.amount = null; },
    data => { data.profile.nextIncome.amount = 0; },
    data => { data.profile.asOf = '2026-02-30'; },
    data => { data.profile.nextIncome.date = data.profile.asOf; },
    data => { data.profile.nextIncome.date = '2027-10-02'; },
    data => { data.purchase.date = data.profile.nextIncome.date; },
    data => { data.profile.currency = 'EUR'; },
    data => { data.profile.upcomingBills[0].date = '2026-10-01'; },
    data => { data.profile.upcomingBills.push(data.profile.upcomingBills[0]); },
    data => { data.transactions.push(data.transactions[0]); },
    data => { data.transactions[0].date = data.profile.asOf; },
    data => { data.transactions[0].kind = 'unknown'; },
    data => { data.transactions = []; },
    data => { delete data.profile.historyStart; },
  ];
  for (const mutate of cases) { const data = input(); mutate(data); assert.throws(() => assessCashflow(data), InputError); }
});

test('cent amounts are stable and each forecast day reconciles', () => {
  const data = input(0.1);
  data.profile.dailyEssentials = 0.1;
  const result = assessCashflow(data);
  assert.equal(result.balanceBeforeNextIncome, 348.5);
  for (const day of result.timeline) {
    assert.equal(Math.round(day.openingBalance * 100) - Math.round(day.billsTotal * 100) - Math.round(day.essentials * 100) - Math.round(day.purchase * 100), Math.round(day.projectedBalance * 100));
  }
});

test('requests do not mutate the sample profile', () => {
  const data = input();
  const before = JSON.stringify(data);
  assessCashflow(data);
  assert.equal(JSON.stringify(data), before);
});

test('HTTP handlers return consistent JSON for demo, custom data, and invalid bodies', async () => {
  assert.equal((await getDemo().json()).transactions.length, 25);
  const demoResponse = await postAssessment(request({ purchase: { label: 'Concert', amount: 180 } }));
  assert.equal(demoResponse.status, 200);
  assert.equal((await demoResponse.json()).isDemo, true);
  const customResponse = await postAssessment(request(input(110)));
  assert.equal((await customResponse.json()).isDemo, false);
  assert.equal((await postAssessment(request({ transactions: [], purchase: { label: 'Concert', amount: 180 } }))).status, 400);
  assert.equal((await postAssessment(request({}))).status, 400);
  assert.equal((await postAssessment(request(null))).status, 400);
  assert.equal((await postAssessment(request({}, { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await postAssessment(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }))).status, 400);
  assert.equal((await postAssessment(request({ padding: 'x'.repeat(270_000) }))).status, 413);
});

test('the standalone HTTP server and typed frontend client work together', async () => {
  const server = createCashflowServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const sample = await loadDemo(base);
    assert.equal(sample.isDemo, true);
    assert.equal(sample.preview.safeToSpend, 110);
    const result = await assessPurchase({ purchase: sample.suggestedPurchase }, base);
    assert.equal(result.decision, 'buffer_risk');
    assert.equal((await fetch(`${base}/api/cashflow/assess`, { method: 'OPTIONS' })).status, 204);
    assert.equal((await fetch(`${base}/api/cashflow/assess`)).status, 405);
    assert.equal((await fetch(`${base}/missing`)).status, 404);
    await assert.rejects(() => assessPurchase({ purchase: { label: 'Concert', amount: -1 } }, base), error => error instanceof CashflowApiError && error.status === 400);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('Next.js route exports invoke the same tested handlers', async () => {
  const demoRoute = await import('../app/api/cashflow/demo/route.js');
  const assessRoute = await import('../app/api/cashflow/assess/route.js');
  assert.equal((await demoRoute.GET().json()).preview.safeToSpend, 110);
  assert.equal((await assessRoute.POST(request({ purchase: { label: 'Concert', amount: 100 } }))).status, 200);
});
