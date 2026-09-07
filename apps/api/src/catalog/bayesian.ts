export const BAYESIAN_PRIOR_VOTES = 25_000;

export function bayesianScore(
  rating: number | null | undefined,
  votes: number | null | undefined,
): number {
  const score = rating ?? 0;
  const count = votes ?? 0;
  return (count / (count + BAYESIAN_PRIOR_VOTES)) * score;
}
