import type { EffectDef } from '../effects';

export const noiseGenerator: EffectDef = {
  id: 'noise',
  label: 'Noise',
  category: 'generator',
  animated: (params) => {
    const speed = params.speed;
    return typeof speed === 'number' && Math.abs(speed) > 0.0001;
  },
  params: [
    {
      kind: 'enum',
      key: 'noiseType',
      label: 'Type',
      options: ['Perlin', 'Value', 'Worley'],
      default: 0,
    },
    {
      kind: 'float',
      key: 'period',
      label: 'Period',
      min: 0.1,
      max: 10,
      step: 0.05,
      default: 1.0,
    },
    {
      kind: 'int',
      key: 'harmonics',
      label: 'Harmonics',
      min: 1,
      max: 6,
      default: 3,
    },
    {
      kind: 'float',
      key: 'roughness',
      label: 'Roughness',
      min: 0.1,
      max: 0.9,
      step: 0.05,
      default: 0.5,
    },
    {
      kind: 'float',
      key: 'speed',
      label: 'Speed',
      min: 0,
      max: 4,
      step: 0.05,
      default: 0.5,
    },
    {
      kind: 'float',
      key: 'contrast',
      label: 'Contrast',
      min: 0,
      max: 3,
      step: 0.05,
      default: 1.0,
    },
    {
      kind: 'float',
      key: 'offset',
      label: 'Offset',
      min: -1,
      max: 1,
      step: 0.02,
      default: 0.0,
    },
    {
      kind: 'float',
      key: 'exponent',
      label: 'Exponent',
      min: 0.2,
      max: 4,
      step: 0.05,
      default: 1.0,
    },
    {
      kind: 'bool',
      key: 'monochrome',
      label: 'Monochrome',
      default: true,
    },
  ],
  fragment: `
  vec2 baseP = aspectUv(v_uv, u_resolution) * (3.0 / max(u_period, 0.01));

  // Seamless across the phase wrap. Perlin and Worley have no periodic
  // form, and the 2.02 lacunarity would break one anyway, so over the last
  // FADE phase units the field is crossfaded into the same field one wrap
  // back -- which is exactly where it resumes once the phase returns to 0.
  // The fade is along a quarter circle (cos/sin weights) so two independent
  // fields blend without the contrast sagging mid-fade.
  const float FADE = 20.0;
  float wrapW = smoothstep(PHASE_WRAP - FADE, PHASE_WRAP, u_phase_speed);
  vec3 fields[2];
  fields[0] = vec3(0.0);
  fields[1] = vec3(0.0);

  for (int e = 0; e < 2; e++) {
    if (e == 1 && wrapW <= 0.0) break;
    float ph = (e == 0) ? u_phase_speed : u_phase_speed - PHASE_WRAP;
    vec2 timeOffset = vec2(ph * 0.7, ph * 0.4) + vec2(u_seed * 19.3);

    // Evaluate multi-octave noise
    float sumR = 0.0;
    float sumG = 0.0;
    float sumB = 0.0;
    float amp = 1.0;
    float maxAmp = 0.0;

    vec2 posR = baseP + timeOffset;
    vec2 posG = baseP + timeOffset + vec2(17.3, 31.7);
    vec2 posB = baseP + timeOffset + vec2(53.1, 71.9);

    for (int i = 0; i < 6; i++) {
      if (i >= u_harmonics) break;

      float sR = 0.0;
      float sG = 0.0;
      float sB = 0.0;

      if (u_noiseType == 0) {
        sR = perlinNoise(posR);
        if (!u_monochrome) {
          sG = perlinNoise(posG);
          sB = perlinNoise(posB);
        }
      } else if (u_noiseType == 1) {
        sR = valueNoise(posR);
        if (!u_monochrome) {
          sG = valueNoise(posG);
          sB = valueNoise(posB);
        }
      } else {
        sR = worleyNoise(posR);
        if (!u_monochrome) {
          sG = worleyNoise(posG);
          sB = worleyNoise(posB);
        }
      }

      sumR += sR * amp;
      if (!u_monochrome) {
        sumG += sG * amp;
        sumB += sB * amp;
      }

      maxAmp += amp;
      amp *= u_roughness;
      posR = posR * 2.02 + vec2(1.7, 9.2);
      if (!u_monochrome) {
        posG = posG * 2.02 + vec2(2.3, 8.7);
        posB = posB * 2.02 + vec2(3.1, 7.9);
      }
    }

    fields[e] = maxAmp > 0.0 ? vec3(sumR, sumG, sumB) / maxAmp : vec3(0.0);
  }

  vec3 field = fields[0];
  if (wrapW > 0.0) {
    float fadeAngle = wrapW * TAU * 0.25;
    field = 0.5 + (fields[0] - 0.5) * cos(fadeAngle) + (fields[1] - 0.5) * sin(fadeAngle);
  }

  float valR = field.r;
  valR = sat((valR - 0.5) * u_contrast + 0.5 + u_offset);
  if (u_exponent != 1.0 && valR > 0.0) {
    valR = pow(valR, u_exponent);
  }

  vec3 col;
  if (u_monochrome) {
    col = vec3(valR);
  } else {
    float valG = field.g;
    valG = sat((valG - 0.5) * u_contrast + 0.5 + u_offset);
    if (u_exponent != 1.0 && valG > 0.0) {
      valG = pow(valG, u_exponent);
    }

    float valB = field.b;
    valB = sat((valB - 0.5) * u_contrast + 0.5 + u_offset);
    if (u_exponent != 1.0 && valB > 0.0) {
      valB = pow(valB, u_exponent);
    }

    col = vec3(valR, valG, valB);
  }

  fragColor = vec4(col, 1.0);
  `,
};
