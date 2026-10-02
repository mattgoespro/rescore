export interface TmdbThroughputSample {
  status: number;
  latencyMs: number;
}

export interface TmdbThroughputResult {
  cap: number;
  attempted: number;
  successful: number;
  effectiveSuccessfulRps: number;
  rateLimited: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

export function summarizeTmdbThroughput(input: {
  cap: number;
  elapsedMs: number;
  samples: TmdbThroughputSample[];
}): TmdbThroughputResult {
  const successful = input.samples.filter(
    (sample) => sample.status >= 200 && sample.status < 300,
  );
  const latencies = successful
    .map((sample) => sample.latencyMs)
    .sort((left, right) => left - right);
  return {
    cap: input.cap,
    attempted: input.samples.length,
    successful: successful.length,
    effectiveSuccessfulRps:
      input.elapsedMs > 0 ? successful.length / (input.elapsedMs / 1_000) : 0,
    rateLimited: input.samples.filter((sample) => sample.status === 429).length,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
  };
}

export function compareTmdbThroughput(
  results: TmdbThroughputResult[],
): Array<
  TmdbThroughputResult & { efficiencyOfCap: number; deltaSuccessfulRps: number }
> {
  const baseline = results.find((result) => result.cap === 20) ?? results[0];
  if (!baseline) return [];
  return results.map((result) => ({
    ...result,
    efficiencyOfCap: Math.round(
      (result.effectiveSuccessfulRps / result.cap) * 100,
    ),
    deltaSuccessfulRps: Number(
      (result.effectiveSuccessfulRps - baseline.effectiveSuccessfulRps).toFixed(
        1,
      ),
    ),
  }));
}

export function compareTmdbKeyPoolThroughput(input: {
  capPerKey: number;
  individual: TmdbThroughputResult[];
  combined: TmdbThroughputResult;
}): {
  capPerKey: number;
  configuredCombinedCap: number;
  individualSuccessfulRps: number;
  combinedSuccessfulRps: number;
  combinedEfficiencyOfCap: number;
  combinedEfficiencyOfIndividual: number;
  rateLimited: number;
} {
  const individualSuccessfulRps = Number(
    input.individual
      .reduce((total, result) => total + result.effectiveSuccessfulRps, 0)
      .toFixed(1),
  );
  const configuredCombinedCap = input.capPerKey * input.individual.length;
  return {
    capPerKey: input.capPerKey,
    configuredCombinedCap,
    individualSuccessfulRps,
    combinedSuccessfulRps: input.combined.effectiveSuccessfulRps,
    combinedEfficiencyOfCap: efficiency(
      input.combined.effectiveSuccessfulRps,
      configuredCombinedCap,
    ),
    combinedEfficiencyOfIndividual: efficiency(
      input.combined.effectiveSuccessfulRps,
      individualSuccessfulRps,
    ),
    rateLimited: input.combined.rateLimited,
  };
}

function efficiency(actual: number, budget: number): number {
  return budget > 0 ? Math.round((actual / budget) * 100) : 0;
}

function percentile(values: number[], percentileValue: number): number {
  if (!values.length) return 0;
  const index = Math.round((values.length - 1) * percentileValue);
  return values[index] ?? 0;
}
