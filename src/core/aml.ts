/**
 * Reading a risk report on an address, as a screening service gives it. The shape is the
 * service's own and may grow; what the wallet shows is read out of it cautiously: a score if
 * there is one, and the names of what the service found. Anything else stays in the raw answer,
 * which the user can open and read whole.
 */
export interface RiskReport {
  /** The service's risk score, as it gave it; null when the answer carries none. */
  score: number | null;
  /** What the service found, by its own names, without repeats. */
  indicators: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function readRiskReport(answer: unknown): RiskReport {
  const top = isObject(answer) ? answer : {};
  // The answer comes wrapped ({ code, message, data }) or bare.
  const data = isObject(top.data) ? top.data : top;
  const pick = (...names: string[]): unknown => names.map((n) => data[n]).find((v) => v !== undefined && v !== null);
  const raw = pick('risk_score', 'riskScore', 'score');
  const score = typeof raw === 'number' && Number.isFinite(raw) ? raw : typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : null;
  const list = pick('risk_indicators', 'riskIndicators', 'indicators', 'risks');
  const names = (Array.isArray(list) ? list : []).flatMap((item): string[] => {
    if (typeof item === 'string') return [item];
    if (!isObject(item)) return [];
    const indicator = isObject(item.indicator) ? item.indicator : item;
    const name = indicator.name ?? indicator.label ?? item.name ?? item.type;
    return typeof name === 'string' && name.trim() ? [name.trim()] : [];
  });
  return { score, indicators: [...new Set(names)].slice(0, 40) };
}

/** Which network an address looks like it belongs to: Tron, Bitcoin, or one of the Ethereum kind; null when it looks like none. */
export function networkOfAddress(address: string): 'tron' | 'bitcoin' | 'evm' | null {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return 'evm';
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return 'tron';
  if (/^(bc1[0-9a-z]{20,80}|[13][1-9A-HJ-NP-Za-km-z]{25,39})$/.test(address)) return 'bitcoin';
  return null;
}
