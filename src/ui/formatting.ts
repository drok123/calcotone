export function formatAlgorithmName(algorithm: string): string {
  if (algorithm === 'bbd') return 'BBD';
  if (algorithm === 'pingpong') return 'Ping Pong';
  return algorithm.charAt(0).toUpperCase() + algorithm.slice(1);
}
