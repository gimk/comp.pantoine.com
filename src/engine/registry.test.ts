import { describe, expect, it } from 'vitest';
import { registry, getEffect } from './registry';
import { CATEGORY_ORDER, defaultParams, paramsOf, inputsOf, buildFragmentSource, passesOf, isPhasedParam } from './effects';

describe('effect registry and module definitions', () => {
  it('registers all effects with valid identifiers and categories', () => {
    const ids = new Set<string>();

    for (const def of registry) {
      expect(def.id).toBeTruthy();
      expect(def.label).toBeTruthy();
      expect(CATEGORY_ORDER).toContain(def.category);
      expect(ids.has(def.id)).toBe(false);
      ids.add(def.id);

      expect(getEffect(def.id)).toBe(def);
    }
  });

  it('includes all newly built flagship modules', () => {
    const expectedNewModules = [
      'mask',
      'dither',
      'pixelate',
      'edgeDetect',
      'halftone',
      'halation',
      'streak',
      'radialBlur',
      'swirl',
      'mapDisplace',
      'blockGlitch',
      'chromaKey',
      'subpixels',
      'ruttEtra',
      'velocityMod',
      'particleFlow',
    ];

    for (const id of expectedNewModules) {
      const def = getEffect(id);
      expect(def).toBeDefined();
      expect(def?.id).toBe(id);
    }
  });

  it('generates valid default parameters for every effect without collisions', () => {
    for (const def of registry) {
      const defaults = defaultParams(def);
      const params = paramsOf(def);
      const inputs = inputsOf(def);

      const keys = new Set<string>();
      for (const p of params) {
        expect(keys.has(p.key)).toBe(false);
        keys.add(p.key);
        expect(defaults[p.key]).toBeDefined();
      }

      for (const input of inputs) {
        expect(keys.has(input.key)).toBe(false);
        keys.add(input.key);
      }
    }
  });

  it('configures multi-input modules with proper input handles', () => {
    const maskDef = getEffect('mask');
    expect(maskDef?.inputs).toEqual([{ key: 'matte', label: 'Matte' }]);

    const mapDisplaceDef = getEffect('mapDisplace');
    expect(mapDisplaceDef?.inputs).toEqual([{ key: 'map', label: 'Map' }]);

    const blendDef = getEffect('blend');
    expect(blendDef?.inputs).toEqual([{ key: 'layer', label: 'Layer' }]);
  });

  it('builds valid fragment sources with phase uniforms declared at global scope', () => {
    for (const def of registry) {
      const passes = passesOf(def);
      const phasedSpecs = paramsOf(def).filter(isPhasedParam);

      passes.forEach((_pass, index) => {
        const source = buildFragmentSource(def, index);
        expect(source).toContain('void main() {');

        const mainIndex = source.indexOf('void main()');
        const uniformsPart = source.slice(0, mainIndex);
        const mainPart = source.slice(mainIndex);

        // Uniforms must only be in global scope
        expect(/\buniform\s+/.test(mainPart)).toBe(false);

        // Phased parameters should have u_phase_<key> declared in the uniform preamble
        for (const spec of phasedSpecs) {
          expect(uniformsPart).toContain(`uniform float u_phase_${spec.key};`);
        }
      });
    }
  });
});

