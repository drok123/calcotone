import type { RecordedWav } from './WavRecorder';
import { masterStereo, measurePeak } from './recorder/mastering';
import { encodePcm24Wave } from './recorder/wavEncoding';

/** Decode the host's little-endian stereo PCM24 capture and build the same
 * RAW/CLEAN/LOUD take contract used by the WebAudio recorder. */
export async function nativeWaveToRecordedWav(blob: Blob): Promise<RecordedWav> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE')
    throw new Error('Native recorder returned an invalid WAV file.');

  let channels = 0, sampleRate = 0, bits = 0, dataOffset = 0, dataSize = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const payload = offset + 8;
    if (id === 'fmt ' && size >= 16) {
      if (view.getUint16(payload, true) !== 1) throw new Error('Native WAV is not PCM.');
      channels = view.getUint16(payload + 2, true);
      sampleRate = view.getUint32(payload + 4, true);
      bits = view.getUint16(payload + 14, true);
    } else if (id === 'data') {
      dataOffset = payload;
      dataSize = Math.min(size, bytes.length - payload);
      break;
    }
    offset = payload + size + (size & 1);
  }
  if (channels !== 2 || bits !== 24 || sampleRate <= 0 || dataSize < 6)
    throw new Error('Native recorder requires stereo 24-bit PCM.');

  const frames = Math.floor(dataSize / 6);
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    left[frame] = decodePcm24(bytes, dataOffset + frame * 6);
    right[frame] = decodePcm24(bytes, dataOffset + frame * 6 + 3);
  }
  const rawPeak = measurePeak(left, right);
  const rawBlob = encodePcm24Wave(left, right, sampleRate);
  const clean = masterStereo(left, right, sampleRate, 'clean');
  const loud = masterStereo(left, right, sampleRate, 'loud');
  const cleanBlob = encodePcm24Wave(clean.left, clean.right, sampleRate);
  const loudBlob = encodePcm24Wave(loud.left, loud.right, sampleRate);
  return {
    blob: cleanBlob, rawBlob, cleanBlob, loudBlob,
    durationSeconds: frames / sampleRate, sampleRate, channels: 2, bitDepth: 24,
    peak: clean.peak, rawPeak, cleanPeak: clean.peak, loudPeak: loud.peak,
    masterMode: 'clean', gainAppliedDb: clean.gainAppliedDb,
    cleanGainDb: clean.gainAppliedDb, loudGainDb: loud.gainAppliedDb,
  };
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function decodePcm24(bytes: Uint8Array, offset: number): number {
  let sample = bytes[offset]! | bytes[offset + 1]! << 8 | bytes[offset + 2]! << 16;
  if (sample & 0x800000) sample |= ~0xffffff;
  return sample / 8_388_608;
}
