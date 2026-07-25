export type VideoWorldKey = 'drift' | 'drift-alt' | 'ember' | 'halo' | 'artifact';

const WORLD_FILES: Record<VideoWorldKey, string> = {
  drift: '/visuals/drift.b64',
  'drift-alt': '/visuals/drift-alt.b64',
  ember: '/visuals/ember.b64',
  halo: '/visuals/halo.b64',
  artifact: '/visuals/artifact.b64',
};

const worldPromises = new Map<VideoWorldKey, Promise<string>>();

function decodeVideoWorld(encoded: string): string {
  // The Git transport stores the tiny web delivery plates as text. Ignore any
  // whitespace so the payload remains robust if GitHub/editor formatting changes.
  const binary = window.atob(encoded.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
}

export function loadVideoWorld(key: VideoWorldKey): Promise<string> {
  const cached = worldPromises.get(key);
  if (cached) return cached;

  const request = fetch(WORLD_FILES[key])
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Unable to load ${key} Dream Field plate (${response.status}).`);
      }
      return response.text();
    })
    .then(decodeVideoWorld);

  worldPromises.set(key, request);
  return request;
}

export async function preloadVideoWorlds(): Promise<Record<VideoWorldKey, string>> {
  const keys: VideoWorldKey[] = ['drift', 'drift-alt', 'ember', 'halo', 'artifact'];
  const urls = await Promise.all(keys.map((key) => loadVideoWorld(key)));
  return keys.reduce((result, key, index) => {
    result[key] = urls[index];
    return result;
  }, {} as Record<VideoWorldKey, string>);
}
