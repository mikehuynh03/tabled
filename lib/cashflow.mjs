const DAY = 86_400_000;
const MAX_AMOUNT = 1_000_000;

export class InputError extends Error {
  constructor(message) { super(message); this.name = 'InputError'; }
}

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError(`${field} must be an object.`);
  return value;
}

function date(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InputError(`${field} must use YYYY-MM-DD.`);
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new InputError(`${field} must be a valid date.`);
  return time;
}

function cents(value, field, signed = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_AMOUNT || (!signed && value < 0)) {
    throw new InputError(`${field} must be a ${signed ? 'finite' : 'non-negative'} dollar amount of at most ${MAX_AMOUNT}.`);
  }
  const rounded = Math.round(value * 100);
  if (Math.abs(value * 100 - rounded) > 0.000001) throw new InputError(`${field} must have at most two decimal places.`);
  return rounded;
}

function label(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) throw new InputError(`${field} must contain 1–120 characters.`);
  return value.trim();
}

const dollars = (value) => value / 100;
const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value % 100 === 0 ? 0 : 2 }).format(dollars(value));

/** Forecast ends immediately before the next income date; that income cannot fund today's purchase. */
export function assessCashflow(input) {
  object(input, 'request');
  const p = object(input.profile, 'profile');
  const purchase = object(input.purchase, 'purchase');
  const name = label(p.name, 'profile.name');
  if (p.currency !== 'USD') throw new InputError('profile.currency must be USD for this prototype.');
  const start = date(p.asOf, 'profile.asOf');
  const income = object(p.nextIncome, 'profile.nextIncome');
  const end = date(income.date, 'profile.nextIncome.date');
  const incomeCents = cents(income.amount, 'profile.nextIncome.amount');
  if (incomeCents === 0) throw new InputError('profile.nextIncome.amount must be greater than zero.');
  const days = (end - start) / DAY;
  if (days < 1 || days > 90) throw new InputError('The next income date must be 1–90 days after profile.asOf.');
  const starting = cents(p.currentBalance, 'profile.currentBalance', true);
  const buffer = cents(p.minimumBuffer, 'profile.minimumBuffer');
  const savings = cents(p.savingsReserve ?? 0, 'profile.savingsReserve');
  const reserve = buffer + savings;
  const amount = cents(purchase.amount, 'purchase.amount');
  const purchaseLabel = label(purchase.label, 'purchase.label');
  const purchaseDate = purchase.date ?? p.asOf;
  const purchaseTime = date(purchaseDate, 'purchase.date');
  if (purchaseTime < start || purchaseTime >= end) throw new InputError('purchase.date must be on or after asOf and before the next income date.');

  if (!Array.isArray(p.upcomingBills) || p.upcomingBills.length > 100) throw new InputError('profile.upcomingBills must be an array with at most 100 bills.');
  const billIds = new Set();
  const bills = p.upcomingBills.map((bill, i) => {
    object(bill, `upcomingBills[${i}]`);
    const id = label(bill.id, `upcomingBills[${i}].id`);
    if (billIds.has(id)) throw new InputError(`Duplicate bill id: ${id}.`);
    billIds.add(id);
    return { id, label: label(bill.label, `upcomingBills[${i}].label`), date: bill.date, time: date(bill.date, `upcomingBills[${i}].date`), cents: cents(bill.amount, `upcomingBills[${i}].amount`) };
  });
  if (bills.some(bill => bill.time < start)) throw new InputError('upcomingBills contains a past-due bill; move unpaid bills to asOf or remove already-paid bills.');

  const transactions = input.transactions ?? [];
  if (!Array.isArray(transactions) || transactions.length > 1000) throw new InputError('transactions must be an array with at most 1000 items.');
  const transactionIds = new Set();
  const historyStart = p.historyStart === undefined ? null : date(p.historyStart, 'profile.historyStart');
  if (historyStart !== null && (historyStart >= start || start - historyStart > DAY * 366)) throw new InputError('historyStart must be 1–366 days before asOf.');
  let essentialHistory = 0;
  for (const [i, transaction] of transactions.entries()) {
    object(transaction, `transactions[${i}]`);
    const id = label(transaction.id, `transactions[${i}].id`);
    if (transactionIds.has(id)) throw new InputError(`Duplicate transaction id: ${id}.`);
    transactionIds.add(id);
    label(transaction.name, `transactions[${i}].name`);
    const time = date(transaction.date, `transactions[${i}].date`);
    if (time >= start || (historyStart !== null && time < historyStart)) throw new InputError('Historical transactions must be before asOf and on or after historyStart when provided.');
    if (!['essential', 'discretionary', 'bill', 'income'].includes(transaction.kind)) throw new InputError(`transactions[${i}].kind must be essential, discretionary, bill, or income.`);
    const value = cents(transaction.amount, `transactions[${i}].amount`);
    if (transaction.kind === 'essential') essentialHistory += value;
  }

  let dailyEssentials;
  let essentialsSource;
  if (p.dailyEssentials !== undefined) {
    dailyEssentials = cents(p.dailyEssentials, 'profile.dailyEssentials');
    essentialsSource = 'profile';
  } else {
    if (historyStart === null || transactions.length === 0) throw new InputError('Provide profile.dailyEssentials or historical transactions with profile.historyStart.');
    // Round upward to the nearest cent so averaging never understates the daily allowance.
    dailyEssentials = Math.ceil(essentialHistory / ((start - historyStart) / DAY));
    essentialsSource = 'transaction_history';
  }

  let baseline = starting;
  let afterPurchase = starting;
  let minBaseline = starting;
  let minimum = starting;
  let minimumDate = p.asOf;
  let availableFromPurchaseDate = Infinity;
  let billsTotal = 0;
  const timeline = [];
  for (let index = 0; index < days; index++) {
    const time = start + index * DAY;
    const day = new Date(time).toISOString().slice(0, 10);
    const due = bills.filter(bill => bill.time === time);
    const billTotal = due.reduce((sum, bill) => sum + bill.cents, 0);
    const purchaseToday = time === purchaseTime ? amount : 0;
    const opening = afterPurchase;
    billsTotal += billTotal;
    baseline -= billTotal + dailyEssentials;
    afterPurchase -= billTotal + dailyEssentials + purchaseToday;
    minBaseline = Math.min(minBaseline, baseline);
    if (afterPurchase < minimum) { minimum = afterPurchase; minimumDate = day; }
    if (time >= purchaseTime) availableFromPurchaseDate = Math.min(availableFromPurchaseDate, baseline - reserve);
    timeline.push({ date: day, openingBalance: dollars(opening), bills: due.map(bill => ({ id: bill.id, label: bill.label, amount: dollars(bill.cents) })), billsTotal: dollars(billTotal), essentials: dollars(dailyEssentials), purchase: dollars(purchaseToday), baselineBalance: dollars(baseline), projectedBalance: dollars(afterPurchase), belowReserve: afterPurchase < reserve });
  }

  const safe = minBaseline < reserve ? 0 : Math.max(0, availableFromPurchaseDate);
  const decision = minimum < 0 ? 'shortfall' : minimum < reserve ? 'buffer_risk' : 'comfortable';
  const explanation = decision === 'comfortable'
    ? `This purchase fits the forecast, leaving a lowest projected balance of ${money(minimum)} before your next income on ${income.date}. Your spending limit is ${money(safe)} after bills, everyday essentials, and ${money(reserve)} kept aside.`
    : decision === 'buffer_risk'
      ? `This purchase would leave a lowest projected balance of ${money(minimum)}, below the ${money(reserve)} you want to keep aside. ${minBaseline < reserve ? 'Even without this purchase, the forecast is below your reserve; review your upcoming expenses or income timing.' : `Keep the purchase at or below ${money(safe)} to preserve that reserve until ${income.date}.`}`
      : `This purchase would leave a projected shortfall of ${money(-minimum)} before your next income on ${income.date}. ${minBaseline < 0 ? 'The forecast already has a shortfall without this purchase; review your upcoming expenses or income timing.' : `Your spending limit while preserving your reserve is ${money(safe)}.`}`;

  return {
    currency: 'USD', name, asOf: p.asOf,
    horizon: { start: p.asOf, endExclusive: income.date, days },
    nextIncome: { date: income.date, amount: dollars(incomeCents), includedInForecast: false },
    purchase: { label: purchaseLabel, amount: dollars(amount), date: purchaseDate },
    decision, safeToSpend: dollars(safe), amountOverSafeLimit: dollars(Math.max(0, amount - safe)),
    currentBalance: dollars(starting), totalUpcomingBills: dollars(billsTotal),
    dailyEssentials: dollars(dailyEssentials), estimatedEssentials: dollars(dailyEssentials * days), essentialsSource,
    minimumBuffer: dollars(buffer), savingsReserve: dollars(savings), protectedReserve: dollars(reserve),
    baselineLowestBalance: dollars(minBaseline), lowestProjectedBalance: dollars(minimum), lowestBalanceDate: minimumDate,
    balanceBeforeNextIncome: dollars(afterPurchase), explanation, timeline,
    assumptions: [
      'Current balance is the opening available balance on asOf; historical transactions are already reflected in it.',
      'Upcoming bills are unpaid, and bills dated on the next income date fall outside this forecast.',
      'No additional income arrives before the stated next income date; changes to that date require a new forecast.',
      essentialsSource === 'profile' ? 'Everyday essentials use the daily amount entered in the profile.' : 'Everyday essentials use tagged essential spending across the full history window, rounded up to the next cent per day.',
      'Spending limits are estimates based on the supplied inputs, not guarantees.'
    ]
  };
}
