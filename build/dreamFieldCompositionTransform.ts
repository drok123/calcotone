import type { Plugin } from 'vite';

function replaceRequired(source: string, before: string, after: string, label: string): string {
  if (!source.includes(before)) throw new Error(`CALCOTONE Dream composition transform: ${label} pattern not found`);
  return source.replace(before, after);
}

/**
 * Keeps the current DreamField source intact while tightening scene composition:
 * world geometry is established before ornamental module rings/guides, and the
 * cyber-city scale is derived from the same horizon/terrain band as the mountains.
 */
export function dreamFieldCompositionTransform(): Plugin {
  return {
    name: 'calcotone-dream-field-composition',
    enforce: 'pre',
    transform(code, id) {
      if (!/[/\\]src[/\\]components[/\\]motion[/\\]DreamFieldEngineV11\.ts(?:\?|$)/.test(id)) return null;
      let next = code;

      next = replaceRequired(
        next,
        `    this.drawSky(ctx, composition);\n    this.drawAtmosphere(ctx, frame.time, layers.atmos, composition);\n    this.drawTerrainAndWater(ctx, layers, composition);\n    this.drawMediaWorld(ctx, frame.time, layers.artifact, composition);\n    this.drawHero(ctx, frame.time, layers.ember, composition);\n    this.drawWaterGuides(ctx, frame.time, layers.drift, composition);`,
        `    this.drawSky(ctx, composition);\n    // Establish the physical world first. Module ornaments/rings belong on top of it.\n    this.drawTerrainAndWater(ctx, layers, composition);\n    this.drawMediaWorld(ctx, frame.time, layers.artifact, layers.halo, composition);\n    this.drawAtmosphere(ctx, frame.time, layers.atmos, composition);\n    this.drawHero(ctx, frame.time, layers.ember, composition);\n    this.drawWaterGuides(ctx, frame.time, layers.drift, composition);`,
        'world-before-ornament render order',
      );

      next = replaceRequired(
        next,
        `  private drawMediaWorld(ctx: CanvasRenderingContext2D, time: number, module: ModuleState | undefined, c: Composition) {\n    if (!module || c.artifact <= 0) return;\n    const mode = module.mediaMode ?? 'cassette';\n    if (mode === 'vhs') return this.drawCyberCity(ctx, time, module, c);`,
        `  private drawMediaWorld(ctx: CanvasRenderingContext2D, time: number, module: ModuleState | undefined, terrainModule: ModuleState | undefined, c: Composition) {\n    if (!module || c.artifact <= 0) return;\n    const mode = module.mediaMode ?? 'cassette';\n    if (mode === 'vhs') return this.drawCyberCity(ctx, time, module, terrainModule, c);`,
        'media world terrain context',
      );

      next = replaceRequired(
        next,
        `  private drawCyberCity(ctx: CanvasRenderingContext2D, time: number, module: ModuleState, c: Composition) {\n    const horizonY = c.horizon * this.height;`,
        `  private drawCyberCity(ctx: CanvasRenderingContext2D, time: number, module: ModuleState, terrainModule: ModuleState | undefined, c: Composition) {\n    const horizonY = c.horizon * this.height;\n    const skyBand = Math.max(1, horizonY);`,
        'cyber city scale context',
      );

      next = replaceRequired(
        next,
        `      const w = this.width * (0.038 + hash(i * 4.2, 0.7) * 0.045);\n      const x = p * this.width - w * 0.5 + (n - 0.5) * this.width * 0.02 - parallax * (0.4 + n * 0.4);\n      const base = horizonY + this.height * (0.012 + hash(i, 1.4) * 0.03);\n      const h = this.height * (0.12 + n * 0.18 + (i % 4 === 0 ? 0.06 : 0)) * (1 + c.audio.low * 0.1);`,
        `      const w = this.width * (0.030 + hash(i * 4.2, 0.7) * 0.034);\n      const x = p * this.width - w * 0.5 + (n - 0.5) * this.width * 0.016 - parallax * (0.32 + n * 0.32);\n      const centerU = clamp01((x + w * 0.5) / Math.max(1, this.width));\n      const terrainLine = this.terrainY(centerU, terrainModule, c) * this.height;\n      const seat = this.height * (0.003 + hash(i, 1.4) * 0.006);\n      const base = terrainLine + seat;\n      const mountainRelief = Math.max(this.height * 0.035, horizonY - terrainLine);\n      const h = Math.min(\n        skyBand * 0.26,\n        mountainRelief * (1.30 + n * 1.10) + skyBand * (0.025 + n * 0.055 + (i % 4 === 0 ? 0.025 : 0))\n      ) * (1 + c.audio.low * 0.055);`,
        'terrain-seated city proportions',
      );

      next = replaceRequired(
        next,
        `      const lean = (this.x - 0.5) * w * 0.1 + Math.sin(time * 0.25 + i) * wow;`,
        `      const lean = (this.x - 0.5) * w * 0.055 + Math.sin(time * 0.25 + i) * wow * 0.55;`,
        'restrained building lean',
      );

      return { code: next, map: null };
    },
  };
}
