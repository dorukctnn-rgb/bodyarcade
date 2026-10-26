// core/render3d: the public surface. Games and the shell import from here; the rest of the folder is the kit's own parts.
export { createScene3D, RenderUnavailableError, DAY_SECONDS, type Scene3DKit, type Scene3DOptions, type Scene3DStats, type QualityMode, type RendererLike, type WorldFrame } from './scene3d.ts';
export { tapFrames, frameDrawn } from './frames.ts';
export { createQualityGovernor, initialQualityLevel, QUALITY_TIERS, tierFor, type GovernorOptions, type GovernorStats, type InitialLevelHints, type QualityGovernorKit, type QualityTier } from './quality.ts';
export { parseTheme, themeOrThrow, themeSignature, ThemeError, THEME_DEFAULTS, THEME_LIMITS, PROP_KINDS, HORIZON_KINDS, WEATHER_KINDS, type Theme, type ThemeParse, type PropDef, type WeatherDef } from './theme.ts';
export { ResourceTracker, disposeTree, addCounts, type ResourceCounts } from './dispose.ts';
export { createPrototypeCache, type PrototypeCache, type PrototypeStats } from './prototype.ts';
export { createBatch, type InstanceBatch } from './instances.ts';
export { makeTexture, createPixels, fillRect, fillPolygon, stripePixels, arrowPixels, spritePixels, blobPixels, noisePixels, roadPixels, horizonPixels, hexToRgb, type Pixels, type TextureOptions } from './textures.ts';
export { fogCutDistance, fogAt, SLICE_LEN } from './scenery.ts';
