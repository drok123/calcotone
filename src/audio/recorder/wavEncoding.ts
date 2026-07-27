export function flattenChunks(chunks: Float32Array[], frameCount: number): Float32Array {
  const output = new Float32Array(frameCount);
  let offset = 0;
  for (const chunk of chunks) {
    const remaining = frameCount - offset;
    if (remaining <= 0) break;
    output.set(chunk.subarray(0, remaining), offset);
    offset += Math.min(chunk.length, remaining);
  }
  return output;
}

export function encodePcm24Wave(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number
): Blob {
  const channelCount = 2;
  const bytesPerSample = 3;
  const blockAlign = channelCount * bytesPerSample;
  const dataBytes = left.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 24, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let index = 0; index < left.length; index += 1) {
    offset = writePcm24(view, offset, left[index]);
    offset = writePcm24(view, offset, right[index]);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writePcm24(view: DataView, offset: number, sample: number): number {
  const dither = (Math.random() - Math.random()) / 8_388_608;
  const clamped = Math.max(-1, Math.min(1, sample + dither));
  const integer = clamped < 0
    ? Math.round(clamped * 8_388_608)
    : Math.round(clamped * 8_388_607);
  view.setUint8(offset, integer & 0xff);
  view.setUint8(offset + 1, (integer >> 8) & 0xff);
  view.setUint8(offset + 2, (integer >> 16) & 0xff);
  return offset + 3;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
