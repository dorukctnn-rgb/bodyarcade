// core/audio: the public surface. Games and the shell import from here; the rest of the folder is the kit's own parts.
export { createAudio, buildMaster, type AudioKit, type AudioOptions, type AudioState, type AudioStats } from './audio.ts';
export { createAudioClock, createLatencyCalibrator, judgeTapMs, type AudioClockKit, type CalibrationResult, type LatencyCalibrator } from './clock.ts';
export { SFX, SFX_NAMES, sfxDuration, type SfxDef } from './sfx.ts';
