# Three.js addons

Source: https://github.com/mrdoob/three.js/tree/r170/examples/jsm
Three.js 0.170.0 MIT (LICENSE.txt). Water.js, Sky.js, BufferGeometryUtils.js.
Imports changed for offline delivery. Water exposes dispose() to release its render target.
Standalone core is 0.180.0; repository uses its existing 0.170.0. Both render paths are tested.
BodyArcade change (9 Nov 2026): Water.js tints the mirrored sky (reflectTint) and caps the grazing-angle reflectance (maxReflectance), so a lake seen from eye height keeps its colour instead of mirroring a white horizon.
