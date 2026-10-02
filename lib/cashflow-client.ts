export type Transaction = {
  id: string;
  date: string;
  name: string;
  /** All amounts are positive dollars; kind distinguishes income from spending. */
  amount: number;
  kind: 'essential' | 'discretionary' | 'bill' | 'income';
};

export type StudentProfile = {
  name: string;
  currency: 'USD';
  /** YYYY-MM-DD. Opening balance is before this day's scheduled expenses. */
  asOf: string;
  currentBalance: number;
  minimumBuffer: number;
  /** Money already in currentBalance that should stay earmarked for savings. */
  savingsReserve?: number;
  nextIncome: { date: string; amount: number };
  upcomingBills: { id: string; label: string; date: string; amount: number }[];
  /** Use this override OR provide historyStart and tagged historical transactions. */
  dailyEssentials?: number;
  historyStart?: string;
};

export type Purchase = { label: string; amount: number; date?: string };
export type AssessmentInput = {
  purchase: Purchase;
  /** Omit profile and transactions together to use the sample student. */
  profile?: StudentProfile;
  transactions?: Transaction[];
};

export type Assessment = {
  isDemo: boolean;
  currency: 'USD';
  name: string;
  asOf: string;
  horizon: { start: string; endExclusive: string; days: number };
  nextIncome: { date: string; amount: number; includedInForecast: false };
  purchase: Required<Purchase>;
  decision: 'comfortable' | 'buffer_risk' | 'shortfall';
  safeToSpend: number;
  amountOverSafeLimit: number;
  currentBalance: number;
  totalUpcomingBills: number;
  dailyEssentials: number;
  estimatedEssentials: number;
  essentialsSource: 'profile' | 'transaction_history';
  minimumBuffer: number;
  savingsReserve: number;
  protectedReserve: number;
  baselineLowestBalance: number;
  lowestProjectedBalance: number;
  lowestBalanceDate: string;
  balanceBeforeNextIncome: number;
  explanation: string;
  timeline: {
    date: string;
    openingBalance: number;
    bills: { id: string; label: string; amount: number }[];
    billsTotal: number;
    essentials: number;
    purchase: number;
    baselineBalance: number;
    projectedBalance: number;
    belowReserve: boolean;
  }[];
  assumptions: string[];
};

export type Demo = {
  isDemo: true;
  profile: StudentProfile;
  transactions: Transaction[];
  suggestedPurchase: Purchase;
  preview: Omit<Assessment, 'isDemo'>;
};

export class CashflowApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'CashflowApiError';
    this.code = code;
    this.status = status;
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const result = await response.json();
  if (!response.ok) throw new CashflowApiError(result.error?.message ?? 'Unable to load forecast.', result.error?.code ?? 'REQUEST_FAILED', response.status);
  return result as T;
}

/** Leave baseUrl empty in Next.js; use http://127.0.0.1:3001 for the standalone runner. */
export async function loadDemo(baseUrl = ''): Promise<Demo> {
  return readResponse<Demo>(await fetch(`${baseUrl}/api/cashflow/demo`, { cache: 'no-store' }));
}

export async function assessPurchase(input: AssessmentInput, baseUrl = ''): Promise<Assessment> {
  return readResponse<Assessment>(await fetch(`${baseUrl}/api/cashflow/assess`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }));
}
