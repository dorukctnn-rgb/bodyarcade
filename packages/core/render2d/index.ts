// core/render2d: the public surface. Games and the shell import from here; the rest of the folder is the kit's own parts.
export { createScene2D, STAGE_COLOR, MAX_BACKING_PIXELS, type Scene2DKit, type Scene2DOptions, type Scene2DStats, type BodyFrame, type HudSetup, type VideoOptions, type CanvasLike } from './scene2d.ts';
export { layoutScene, layoutDuo, layoutProblems, type SceneRects, type LayoutInput, type DuoInput } from './layout2d.ts';
export { fitContain, makeProjector, bodyToView, viewToBody, viewToCanvas, canvasToView, landmarkToCanvas, torsoPixels, type Projector, type Rect } from './view.ts';
export { BODY_STYLES, LandmarkSmoother, createPoints, toCanvasPoints, drawSkeleton, drawSilhouette, bodyScale, skeletonSegments, type BodyStyle } from './body.ts';
export { drawPip, PIP_STYLE, roundedRectPath, type PipDraw } from './pip.ts';
export { createParticles, DEFAULT_COLORS, type Particles, type ParticleOptions, type BurstOptions } from './particles.ts';
export { SpriteBank, drawSprite, SPRITE_KINDS, DEFAULT_STYLE, type SpriteKind, type SpriteStyle } from './sprites.ts';
export { domSurface, releaseSurface, type Ctx2D, type Surface, type SurfaceFactory } from './ctx.ts';
