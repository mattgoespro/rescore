import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareTmdbKeyPoolThroughput,
  compareTmdbThroughput,
  summarizeTmdbThroughput,
} from "./tmdb-throughput.js";

test("summarizes successful RPS, latency percentiles, and rate limits", () => {
  const result = summarizeTmdbThroughput({
    cap: 20,
    elapsedMs: 2_000,
    samples: [
      { status: 200, latencyMs: 10 },
      { status: 200, latencyMs: 20 },
      { status: 429, latencyMs: 30 },
      { status: 500, latencyMs: 40 },
    ],
  });

  assert.deepEqual(result, {
    cap: 20,
    attempted: 4,
    successful: 2,
    effectiveSuccessfulRps: 1,
    rateLimited: 1,
    p50LatencyMs: 20,
    p95LatencyMs: 20,
  });
});

test("compares combined multi-key throughput with its configured budget", () => {
  const result = compareTmdbKeyPoolThroughput({
    capPerKey: 40,
    individual: [
      {
        cap: 40,
        attempted: 120,
        successful: 120,
        effectiveSuccessfulRps: 32,
        rateLimited: 0,
        p50LatencyMs: 60,
        p95LatencyMs: 100,
      },
      {
        cap: 40,
        attempted: 120,
        successful: 120,
        effectiveSuccessfulRps: 30,
        rateLimited: 0,
        p50LatencyMs: 65,
        p95LatencyMs: 105,
      },
    ],
    combined: {
      cap: 80,
      attempted: 240,
      successful: 240,
      effectiveSuccessfulRps: 58,
      rateLimited: 0,
      p50LatencyMs: 70,
      p95LatencyMs: 120,
    },
  });

  assert.deepEqual(result, {
    capPerKey: 40,
    configuredCombinedCap: 80,
    individualSuccessfulRps: 62,
    combinedSuccessfulRps: 58,
    combinedEfficiencyOfCap: 73,
    combinedEfficiencyOfIndividual: 94,
    rateLimited: 0,
  });
});

test("compares each cap to the current budget", () => {
  const comparison = compareTmdbThroughput([
    {
      cap: 20,
      attempted: 120,
      successful: 120,
      effectiveSuccessfulRps: 19.8,
      rateLimited: 0,
      p50LatencyMs: 70,
      p95LatencyMs: 120,
    },
    {
      cap: 40,
      attempted: 120,
      successful: 110,
      effectiveSuccessfulRps: 28,
      rateLimited: 10,
      p50LatencyMs: 90,
      p95LatencyMs: 300,
    },
  ]);

  assert.deepEqual(comparison, [
    {
      ...comparison[0],
      efficiencyOfCap: 99,
      deltaSuccessfulRps: 0,
    },
    {
      ...comparison[1],
      efficiencyOfCap: 70,
      deltaSuccessfulRps: 8.2,
    },
  ]);
});
