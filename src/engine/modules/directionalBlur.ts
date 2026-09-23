import type { EffectDef } from '../effects';

/**
 * A smear along one angle -- motion blur, or the horizontal drag of a
 * signal that cannot keep up with itself.
 *
 * Single pass, because a directional blur is already one-dimensional and
 * there is no second axis to separate out.
 *
 * Trail is the difference between motion blur and a smear. Centred, the
 * samples sit either side of the pixel with a Gaussian falloff and the
 * picture stays where it is. Trailing, they only reach backwards with a
 * linear decay, so the image keeps its leading edge sharp and drags a tail
 * -- which is the half that reads as tape.
 */
export const directionalBlur: EffectDef = {
  id: 'directionalBlur',
  label: 'Directional Blur',
  category: 'optics',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'length', label: 'Length', min: 0, max: 128, step: 0.5, default: 12 },
    { kind: 'float', key: 'angle', label: 'Angle', min: -0.5, max: 0.5, step: 0.005, default: 0 },
    { kind: 'bool', key: 'trail', label: 'Trail', default: false },
  ],
  fragment: `  const int TAPS = 12;
  float a = u_angle * TAU;
  vec2 stepUv = vec2(cos(a), sin(a)) * u_length / u_resolution;

  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = 0; i <= TAPS; i++) {
    float t = float(i) / float(TAPS);
    float offset = u_trail ? t : t - 0.5;
    float d = t - 0.5;
    float w = u_trail ? (1.0 - t) : exp(-8.0 * d * d);
    sum += texture(u_src, v_uv + stepUv * offset) * w;
    total += w;
  }
  fragColor = sum / max(total, 0.0001);`,
};
