import type { EffectDef, ParamSpec, ParamValue, Vec2 } from '../effects';

/**
 * Tone curves: one through the three channels together, and one per
 * channel, each through up to eight points.
 *
 * The points are plain params -- a count and eight point slots per curve
 * -- edited on the card by CurvesEditor rather than as rows, the way a
 * Ramp's stops are. That keeps save, undo and presets working unchanged.
 * They are hidden and portless: a curve is shaped by hand, not wired.
 *
 * The curve through the points is a monotone cubic (Fritsch-Butland
 * tangents): smooth, but it never overshoots a point, so a curve cannot
 * push a value out of range or make a gradient run backwards between two
 * points that both go up. Past the end points it is flat.
 *
 * Each channel goes through its own curve first, then the RGB curve, the
 * order Photoshop applies them in.
 */

export const CURVE_IDS = ['m', 'r', 'g', 'b'] as const;
export type CurveId = (typeof CURVE_IDS)[number];
export const MAX_POINTS = 8;
export const MIN_POINTS = 2;

export const countKey = (curve: CurveId) => `${curve}Count`;
export const pointKey = (curve: CurveId, slot: number) => `${curve}P${slot}`;

/** Unused slots hold (1, 1), the last default point, so they are harmless. */
const defaultPoint = (slot: number): Vec2 => (slot === 0 ? [0, 0] : [1, 1]);

const curveParams = (curve: CurveId): ParamSpec[] => [
  { kind: 'int', key: countKey(curve), label: `${curve} points`, min: MIN_POINTS, max: MAX_POINTS, default: 2, hidden: true, portless: true },
  ...Array.from({ length: MAX_POINTS }, (_, slot): ParamSpec => ({
    kind: 'vec2',
    key: pointKey(curve, slot),
    label: `${curve} point ${slot + 1}`,
    min: 0,
    max: 1,
    step: 0.001,
    default: defaultPoint(slot),
    hidden: true,
    portless: true,
  })),
];

/** A curve's points as stored on a node, in slot order. */
export const readCurve = (params: Record<string, ParamValue>, curve: CurveId): Vec2[] => {
  const raw = params[countKey(curve)];
  const count = Math.min(MAX_POINTS, Math.max(MIN_POINTS, typeof raw === 'number' ? Math.round(raw) : 2));
  return Array.from({ length: count }, (_, slot) => {
    const point = params[pointKey(curve, slot)];
    return Array.isArray(point) && point.length === 2 ? ([point[0], point[1]] as Vec2) : defaultPoint(slot);
  });
};

/** The params that store `points` as a curve, sorted by x, as one patch. */
export const writeCurve = (curve: CurveId, points: Vec2[]): Record<string, ParamValue> => {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const patch: Record<string, ParamValue> = { [countKey(curve)]: sorted.length };
  for (let slot = 0; slot < MAX_POINTS; slot += 1) {
    patch[pointKey(curve, slot)] = sorted[slot] ?? defaultPoint(slot);
  }
  return patch;
};

const EPSILON = 1e-5;

/** Tangent at a point between two secants: their harmonic mean, or flat at a turn. */
const tangent = (before: number, after: number): number =>
  before * after > 0 ? 2 / (1 / before + 1 / after) : 0;

/** The curve through sorted `points` at `x`. The shader below is the same, line for line. */
export const evalCurve = (points: Vec2[], x: number): number => {
  const n = points.length;
  if (x <= points[0][0]) return points[0][1];
  if (x >= points[n - 1][0]) return points[n - 1][1];
  let k = 0;
  for (let i = 0; i < n - 1; i += 1) if (x >= points[i][0]) k = i;
  const [ax, ay] = points[k];
  const [bx, by] = points[k + 1];
  const h = Math.max(bx - ax, EPSILON);
  const d = (by - ay) / h;
  let m0 = d;
  let m1 = d;
  if (k > 0) {
    const [px, py] = points[k - 1];
    m0 = tangent((ay - py) / Math.max(ax - px, EPSILON), d);
  }
  if (k < n - 2) {
    const [qx, qy] = points[k + 2];
    m1 = tangent(d, (qy - by) / Math.max(qx - bx, EPSILON));
  }
  const t = (x - ax) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const y =
    (2 * t3 - 3 * t2 + 1) * ay + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * by + (t3 - t2) * h * m1;
  return Math.min(1, Math.max(0, y));
};

/** GLSL that sets `out` to curve `index` at `x`, in a block of its own. */
const evalGlsl = (index: number, x: string, out: string) => `  {
    int base = ${index * MAX_POINTS};
    int n = int(clamp(float(N[${index}]), ${MIN_POINTS}.0, ${MAX_POINTS}.0));
    float x = ${x};
    float y;
    if (x <= P[base].x) {
      y = P[base].y;
    } else if (x >= P[base + n - 1].x) {
      y = P[base + n - 1].y;
    } else {
      int k = 0;
      for (int i = 0; i < ${MAX_POINTS - 1}; i++) {
        if (i < n - 1 && x >= P[base + i].x) k = i;
      }
      vec2 a = P[base + k];
      vec2 b = P[base + k + 1];
      float h = max(b.x - a.x, ${EPSILON});
      float d = (b.y - a.y) / h;
      float m0 = d;
      float m1 = d;
      if (k > 0) {
        vec2 p = P[base + k - 1];
        float before = (a.y - p.y) / max(a.x - p.x, ${EPSILON});
        m0 = before * d > 0.0 ? 2.0 / (1.0 / before + 1.0 / d) : 0.0;
      }
      if (k < n - 2) {
        vec2 q = P[base + k + 2];
        float after = (q.y - b.y) / max(q.x - b.x, ${EPSILON});
        m1 = d * after > 0.0 ? 2.0 / (1.0 / d + 1.0 / after) : 0.0;
      }
      float t = (x - a.x) / h;
      float t2 = t * t;
      float t3 = t2 * t;
      y = (2.0 * t3 - 3.0 * t2 + 1.0) * a.y + (t3 - 2.0 * t2 + t) * h * m0
        + (-2.0 * t3 + 3.0 * t2) * b.y + (t3 - t2) * h * m1;
    }
    ${out} = clamp(y, 0.0, 1.0);
  }
`;

const points = CURVE_IDS.flatMap((curve) => Array.from({ length: MAX_POINTS }, (_, slot) => `u_${pointKey(curve, slot)}`));

export const curves: EffectDef = {
  id: 'curves',
  label: 'Curves',
  category: 'color',
  animated: false,
  mixable: true,
  params: CURVE_IDS.flatMap(curveParams),
  fragment: `  vec4 src = texture(u_src, v_uv);
  vec2 P[${points.length}] = vec2[${points.length}](${points.join(', ')});
  int N[4] = int[4](${CURVE_IDS.map((curve) => `u_${countKey(curve)}`).join(', ')});
  vec3 c = sat(src.rgb);
${evalGlsl(1, 'c.r', 'c.r')}${evalGlsl(2, 'c.g', 'c.g')}${evalGlsl(3, 'c.b', 'c.b')}${evalGlsl(0, 'c.r', 'c.r')}${evalGlsl(0, 'c.g', 'c.g')}${evalGlsl(0, 'c.b', 'c.b')}  fragColor = vec4(c, src.a);`,
};
