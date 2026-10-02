import demo from './data/cashflow-demo.json' with { type: 'json' };
import { assessCashflow, InputError } from './cashflow.mjs';

const MAX_BODY = 256 * 1024;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export function getDemo() {
  return json({ isDemo: true, ...demo, preview: assessCashflow({ ...demo, purchase: demo.suggestedPurchase }) });
}

async function readJson(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return { error: json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Send Content-Type: application/json.' } }, 415) };
  if (Number(request.headers.get('content-length')) > MAX_BODY) return { error: json({ error: { code: 'BODY_TOO_LARGE', message: 'Request must be at most 256 KB.' } }, 413) };
  if (!request.body) throw new InputError('Request body must contain JSON.');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        return { error: json({ error: { code: 'BODY_TOO_LARGE', message: 'Request must be at most 256 KB.' } }, 413) };
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { value: JSON.parse(new TextDecoder().decode(bytes)) }; }
  catch { throw new InputError('Request body must contain valid JSON.'); }
}

export async function postAssessment(request) {
  try {
    const parsed = await readJson(request);
    if (parsed.error) return parsed.error;
    const body = parsed.value;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('Request must be a JSON object.');
    const isDemo = body.profile === undefined;
    if (isDemo && body.transactions !== undefined) throw new InputError('Provide a profile with uploaded transactions so their balance and dates are explicit.');
    const input = isDemo ? { profile: demo.profile, transactions: demo.transactions, purchase: body.purchase } : body;
    return json({ isDemo, ...assessCashflow(input) });
  } catch (error) {
    if (error instanceof InputError) return json({ error: { code: 'INVALID_INPUT', message: error.message } }, 400);
    return json({ error: { code: 'INTERNAL_ERROR', message: 'Unable to calculate this forecast.' } }, 500);
  }
}
