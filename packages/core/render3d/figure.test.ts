// The runner's own light in a night world (figure.ts withFigureLight, looks.ts figureLight): the shader patch finds its two places in
// today's three.js standard material, and only the night world asks for it.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { withFigureLight } from './figure.ts';
import { lookOf } from './looks.ts';
import worldsJson from './themes/classic-worlds.json' with { type: 'json' };

describe('the runner in a night world', () => {
  it('adds a fill and a rim to the standard material, after its own glow and before the lights', () => {
    const src = THREE.ShaderLib.standard.fragmentShader;
    const out = withFigureLight(src);
    expect(out).toContain('uniform float baFigFill;');
    expect(out).toContain('uniform vec3 baFigRim;');
    const glow = out.indexOf('#include <emissivemap_fragment>');
    const added = out.indexOf('totalEmissiveRadiance += diffuseColor.rgb * baFigFill');
    expect(added).toBeGreaterThan(glow);
    expect(added).toBeLessThan(out.indexOf('#include <lights_physical_fragment>'));
  });

  it('refuses a shader that no longer has the places it goes in', () => {
    expect(() => withFigureLight('void main() { gl_FragColor = vec4(1.0); }')).toThrow(/shader has changed/);
  });

  it('is asked for by the city only (the camera sees the runner against the moon); the day worlds keep their own lights', () => {
    const lit = (worldsJson as { id: string }[]).filter((w) => lookOf(w.id).figureLight).map((w) => w.id);
    expect(lit).toEqual(['city']);
    const city = lookOf('city').figureLight!;
    expect(city.fill).toBeGreaterThan(0);
    expect(city.rimStrength).toBeGreaterThan(0);
    expect(city.rim).toMatch(/^#[0-9a-f]{6}$/i);
    expect(lookOf('alps').figureLight).toBeNull();
  });
});
