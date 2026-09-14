import fs from 'node:fs';
import path from 'node:path';

function percent(value, label) {
  if (value == null || value === '' || value === 'unknown') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`${label} precisa estar entre 0 e 100, ou unknown.`);
  }
  return parsed;
}

export function measurementCachePath(ledgerRepo, project) {
  return path.join(ledgerRepo, '.git', `measurement-${project}.json`);
}

export function readMeasurement({
  args,
  ledgerRepo,
  project,
  cacheMinutes = 15,
  now = Date.now(),
}) {
  const explicit =
    args.quotaRemaining !== undefined || args.contextRemaining !== undefined;
  const file = measurementCachePath(ledgerRepo, project);

  if (!explicit && fs.existsSync(file)) {
    try {
      const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
      const ageMs = now - Date.parse(cached.measuredAt);
      if (ageMs >= 0 && ageMs <= cacheMinutes * 60_000) {
        return { ...cached, cached: true };
      }
    } catch {
      // Cache é otimização local, nunca fonte obrigatória.
    }
  }

  const measured = {
    quotaRemainingPercent: percent(args.quotaRemaining, 'quota remaining'),
    contextRemainingPercent: percent(args.contextRemaining, 'context remaining'),
    measuredAt: args.measuredAt || new Date(now).toISOString(),
    source: args.measurementSource || (explicit ? 'provided-by-host' : 'unknown'),
    cached: false,
  };
  fs.writeFileSync(file, `${JSON.stringify(measured)}\n`, { mode: 0o600 });
  return measured;
}

export function resourceDecision(measurement, thresholdPercent = 20) {
  const known = [
    ['quota', measurement.quotaRemainingPercent],
    ['context', measurement.contextRemainingPercent],
  ].filter(([, value]) => value != null);
  const atRisk = known.filter(([, value]) => value <= thresholdPercent);
  return {
    thresholdPercent,
    known: Object.fromEntries(known),
    unknown: ['quota', 'context'].filter(
      (name) => !known.some(([knownName]) => knownName === name),
    ),
    atRisk: atRisk.map(([name]) => name),
    arm: atRisk.length > 0,
  };
}
