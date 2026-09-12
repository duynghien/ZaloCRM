/** Closing admission also fences producers already awaiting database work. */
let accepting = true;
const producers = new Set<Promise<unknown>>();
export class ReportAdmissionClosedError extends Error { readonly statusCode = 503; constructor() { super('Report admission is closed'); } }
export function assertReportAdmission(): void { if (!accepting) throw new ReportAdmissionClosedError(); }
export function closeReportAdmission(): void { accepting = false; }
export function openReportAdmission(): void { accepting = true; }
export async function trackReportProducer<T>(work: () => Promise<T>): Promise<T> {
  assertReportAdmission();
  const pending = work(); producers.add(pending);
  try { return await pending; } finally { producers.delete(pending); }
}
export async function drainReportProducers(timeoutMs = 30_000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try { await Promise.race([Promise.all([...producers]), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Report producer drain timed out; abort cutover')), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}
