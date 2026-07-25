export type VideoWorldKey = 'drift' | 'drift-alt' | 'ember' | 'halo' | 'artifact';

const WORLD_FILES: Record<VideoWorldKey, string> = {
  drift: 'visuals/drift.b64',
  'drift-alt': 'visuals/drift-alt.b64',
  ember: 'visuals/ember.b64',
  halo: 'visuals/halo.b64',
  artifact: 'visuals/artifact.b64',
};

const worldPromises = new Map<VideoWorldKey, Promise<string>>();

function worldFileUrl(key: VideoWorldKey): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
  return `${base}${WORLD_FILES[key]}`;
}

function decodeVideoWorld(encoded: string): string {
  // The Git transport stores the web delivery plates as text. Ignore whitespace so
  // GitHub/editor formatting cannot corrupt the decoded MP4 payload.
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

  const request = fetch(worldFileUrl(key), { cache: 'force-cache' })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Unable to load ${key} Dream Field plate (${response.status}).`);
      }
      return response.text();
    })
    .then(decodeVideoWorld)
    .catch((error) => {
      // A failed request must not poison the cache forever. The next activation can retry.
      worldPromises.delete(key);
      throw error;
    });

  worldPromises.set(key, request);
  return request;
}
