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
  vec2 timeOffset = vec2(u_phase_speed * 0.7, u_phase_speed * 0.4) + vec2(u_seed * 19.3);

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

  float valR = maxAmp > 0.0 ? sumR / maxAmp : 0.0;
  valR = sat((valR - 0.5) * u_contrast + 0.5 + u_offset);
  if (u_exponent != 1.0 && valR > 0.0) {
    valR = pow(valR, u_exponent);
  }

  vec3 col;
  if (u_monochrome) {
    col = vec3(valR);
  } else {
    float valG = maxAmp > 0.0 ? sumG / maxAmp : 0.0;
    valG = sat((valG - 0.5) * u_contrast + 0.5 + u_offset);
    if (u_exponent != 1.0 && valG > 0.0) {
      valG = pow(valG, u_exponent);
    }

    float valB = maxAmp > 0.0 ? sumB / maxAmp : 0.0;
    valB = sat((valB - 0.5) * u_contrast + 0.5 + u_offset);
    if (u_exponent != 1.0 && valB > 0.0) {
      valB = pow(valB, u_exponent);
    }

    col = vec3(valR, valG, valB);
  }

  fragColor = vec4(col, 1.0);
  `,
};
