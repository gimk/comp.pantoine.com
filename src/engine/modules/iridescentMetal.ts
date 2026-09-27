import type { EffectDef } from '../effects';

/**
 * 3D embossed normal estimation with thin-film optical interference, liquid chrome
 * reflections, and metallic sheen.
 */
export const iridescentMetal: EffectDef = {
  id: 'iridescentMetal',
  label: 'Iridescent Metal',
  category: 'stylize',
  animated: false,
  mixable: true,
  params: [
    { kind: 'float', key: 'depth', label: 'Depth', min: 0, max: 5, step: 0.05, default: 1.5 },
    { kind: 'float', key: 'smoothness', label: 'Smoothness', min: 0, max: 1, step: 0.01, default: 0.5 },
    { kind: 'float', key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01, default: 0.2 },
    { kind: 'float', key: 'iridescence', label: 'Iridescence', min: 0, max: 1, step: 0.01, default: 0.7 },
    {
      kind: 'enum',
      key: 'palette',
      label: 'Palette',
      options: ['Oil Slick', 'Rainbow', 'Titanium', 'Pearl', 'Mercury'],
      default: 0,
    },
    { kind: 'float', key: 'lightAngle', label: 'Light Angle', min: 0, max: 360, step: 1, default: 45 },
    { kind: 'float', key: 'reflection', label: 'Reflection', min: 0, max: 1, step: 0.01, default: 0.4 },
  ],
  fragment: `
  vec2 px = 1.0 / u_resolution;

  // Multi-scale filter spread for surface curvature
  float filterDist = mix(1.0, 12.0, u_smoothness);
  vec2 sampleDist = px * filterDist;

  // 3x3 Sobel filter with expanded radius to produce smooth, sculptural liquid normals
  float l00 = luma(texture(u_src, v_uv + vec2(-sampleDist.x, -sampleDist.y)).rgb);
  float l10 = luma(texture(u_src, v_uv + vec2(0.0, -sampleDist.y)).rgb);
  float l20 = luma(texture(u_src, v_uv + vec2(sampleDist.x, -sampleDist.y)).rgb);
  float l01 = luma(texture(u_src, v_uv + vec2(-sampleDist.x, 0.0)).rgb);
  float l21 = luma(texture(u_src, v_uv + vec2(sampleDist.x, 0.0)).rgb);
  float l02 = luma(texture(u_src, v_uv + vec2(-sampleDist.x, sampleDist.y)).rgb);
  float l12 = luma(texture(u_src, v_uv + vec2(0.0, sampleDist.y)).rgb);
  float l22 = luma(texture(u_src, v_uv + vec2(sampleDist.x, sampleDist.y)).rgb);

  // Intermediate taps for continuous contour smoothing
  float inL10 = luma(texture(u_src, v_uv + vec2(0.0, -sampleDist.y * 0.5)).rgb);
  float inL12 = luma(texture(u_src, v_uv + vec2(0.0, sampleDist.y * 0.5)).rgb);
  float inL01 = luma(texture(u_src, v_uv + vec2(-sampleDist.x * 0.5, 0.0)).rgb);
  float inL21 = luma(texture(u_src, v_uv + vec2(sampleDist.x * 0.5, 0.0)).rgb);

  float dx = ((l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02)) * 0.7 + (inL21 - inL01) * 0.6;
  float dy = ((l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20)) * 0.7 + (inL12 - inL10) * 0.6;

  // Surface relief normal, softened by roughness
  vec3 rawNormal = normalize(vec3(-dx * u_depth * 2.5, -dy * u_depth * 2.5, 1.0));
  vec3 normal = normalize(mix(rawNormal, vec3(0.0, 0.0, 1.0), u_roughness * 0.5));
  vec3 viewDir = vec3(0.0, 0.0, 1.0);

  // Directional lighting
  float rad = radians(u_lightAngle);
  vec3 lightDir = normalize(vec3(cos(rad), sin(rad), 0.7));
  vec3 halfVec = normalize(lightDir + viewDir);

  float ndotl = max(dot(normal, lightDir), 0.0);
  float ndoth = max(dot(normal, halfVec), 0.0);
  float ndotv = max(dot(normal, viewDir), 0.0);

  // Blinn-Phong specular highlight: sharp peak on low roughness, wide soft glow on high roughness
  float shininess = mix(180.0, 4.0, u_roughness);
  float specPower = mix(2.5, 0.45, u_roughness);
  float spec = pow(ndoth, shininess) * specPower;

  // Thin-film Fresnel interference angle
  float fresnel = 1.0 - ndotv;
  float t = fresnel * 1.5 + (normal.x + normal.y) * 0.25;

  // Cosine spectral palettes: A + B * cos(TAU * (C * t + D))
  vec3 a = vec3(0.5);
  vec3 b = vec3(0.5);
  vec3 c = vec3(1.0);
  vec3 d = vec3(0.0, 0.33, 0.67);

  if (u_palette == 1) {
    // Rainbow
    a = vec3(0.5);
    b = vec3(0.5);
    c = vec3(2.0);
    d = vec3(0.0, 0.33, 0.67);
  } else if (u_palette == 2) {
    // Titanium
    a = vec3(0.8, 0.5, 0.4);
    b = vec3(0.2, 0.4, 0.2);
    c = vec3(2.0, 1.0, 1.0);
    d = vec3(0.0, 0.25, 0.5);
  } else if (u_palette == 3) {
    // Pearl
    a = vec3(0.9, 0.85, 0.9);
    b = vec3(0.12, 0.15, 0.15);
    c = vec3(1.0);
    d = vec3(0.3, 0.2, 0.8);
  } else if (u_palette == 4) {
    // Mercury / Chrome
    a = vec3(0.72, 0.74, 0.78);
    b = vec3(0.25);
    c = vec3(1.0);
    d = vec3(0.0);
  }

  vec3 spectralColor = a + b * cos(TAU * (c * t + d));
  // Roughness diffuses the thin-film interference bands into a silky sheen
  spectralColor = mix(spectralColor, a, u_roughness * 0.55);

  // Surface reflection with roughness-controlled multi-tap frosted blur
  vec2 reflOffset = normal.xy * (u_reflection * 0.08);
  float blurRadius = u_roughness * 7.0;
  vec2 blurStep = px * blurRadius;

  vec4 srcCol = texture(u_src, clamp(v_uv + reflOffset, 0.0, 1.0)) * 0.36;
  srcCol += texture(u_src, clamp(v_uv + reflOffset + vec2(blurStep.x, blurStep.y), 0.0, 1.0)) * 0.16;
  srcCol += texture(u_src, clamp(v_uv + reflOffset - vec2(blurStep.x, blurStep.y), 0.0, 1.0)) * 0.16;
  srcCol += texture(u_src, clamp(v_uv + reflOffset + vec2(-blurStep.x, blurStep.y), 0.0, 1.0)) * 0.16;
  srcCol += texture(u_src, clamp(v_uv + reflOffset + vec2(blurStep.x, -blurStep.y), 0.0, 1.0)) * 0.16;

  // Combine metallic sheen, spectral iridescence, and specular highlights
  vec3 metallicBase = mix(srcCol.rgb, spectralColor, u_iridescence);
  vec3 litColor = metallicBase * (0.35 + 0.65 * ndotl) + vec3(spec);

  fragColor = vec4(clamp(litColor, 0.0, 1.0), srcCol.a);
  `,
};
