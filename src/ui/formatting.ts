export function formatAlgorithmName(algorithm: string): string {
  if (algorithm === 'bbd') return 'BBD';
  if (algorithm === 'pingpong') return 'Ping Pong';
  if (algorithm === 're201') return 'RE-201 Space Echo';
  return algorithm.charAt(0).toUpperCase() + algorithm.slice(1);
}
