/**
 * Static checks over every shader the registry can produce.
 *
 * TypeScript has nothing to say about the contents of a template literal, so
 * without this the first time anyone finds out a shader is malformed is when
 * a GPU refuses it at runtime. That has already happened once: `active` is a
 * reserved word in GLSL ES, two modules used it as a variable, and the app
 * white-screened.
 *
 * Two passes, because they catch different things:
 *
 *   - the reserved-word scan catches identifiers the language forbids, which
 *     a parser will happily accept as perfectly ordinary syntax;
 *   - the parse catches malformed syntax the word list knows nothing about.
 *
 * Neither is a compiler. Type errors -- a vec3 handed to a float -- still
 * only surface on a real driver, and that gap is why `programFor` falls back
 * to a pass-through rather than trusting this to have caught everything.
 */
import { build } from 'esbuild';
import { parser } from '@shaderfrog/glsl-parser/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/*
 * GLSL ES 3.00 words reserved for future use, plus qualifiers that could
 * only appear in a body here by mistake. None may name a variable.
 */
const RESERVED = [
  'common', 'partition', 'active', 'asm', 'class', 'union', 'enum', 'typedef',
  'template', 'this', 'resource', 'goto', 'inline', 'noinline', 'public',
  'static', 'extern', 'external', 'interface', 'long', 'short', 'half',
  'fixed', 'unsigned', 'superp', 'input', 'output', 'filter', 'sizeof',
  'cast', 'namespace', 'using', 'attribute', 'varying', 'coherent',
  'volatile', 'restrict', 'readonly', 'writeonly', 'atomic_uint',
  'noperspective', 'patch', 'sample', 'subroutine', 'buffer', 'shared',
  'packed', 'row_major', 'precise', 'hvec2', 'hvec3', 'hvec4', 'fvec2',
  'fvec3', 'fvec4', 'dvec2', 'dvec3', 'dvec4', 'sampler3DRect',
];
const reservedPattern = new RegExp('\\b(' + RESERVED.join('|') + ')\\b');

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** The registry is TypeScript; bundle it to something node can import. */
const loadRegistry = async (dir) => {
  const outfile = join(dir, 'registry.mjs');
  await build({
    entryPoints: ['src/engine/registry.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'warning',
  });
  const effects = join(dir, 'effects.mjs');
  await build({
    entryPoints: ['src/engine/effects.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: effects,
    logLevel: 'warning',
  });
  return {
    registry: (await import(pathToFileURL(outfile).href)).registry,
    effects: await import(pathToFileURL(effects).href),
  };
};

const dir = await mkdtemp(join(tmpdir(), 'comp-shaders-'));
let failures = 0;
let checked = 0;

try {
  const { registry, effects } = await loadRegistry(dir);
  const { buildFragmentSource, passesOf } = effects;

  for (const def of registry) {
    passesOf(def).forEach((_body, index) => {
      const label = `${def.id}#${index}`;
      let source;

      // buildFragmentSource also enforces the param rules, so a bad param
      // key fails here rather than silently shadowing a built-in uniform.
      try {
        source = buildFragmentSource(def, index);
      } catch (error) {
        failures += 1;
        console.error(`FAIL  ${label}  ${error.message}`);
        return;
      }

      checked += 1;
      const body = stripComments(source);

      const reserved = body.match(reservedPattern);
      if (reserved) {
        failures += 1;
        console.error(`FAIL  ${label}  uses the reserved word "${reserved[1]}"`);
      }

      const mainIndex = body.indexOf('void main()');
      if (mainIndex !== -1 && /\buniform\s+/.test(body.slice(mainIndex))) {
        failures += 1;
        console.error(`FAIL  ${label}  declares a uniform inside function body (uniforms must be global)`);
      }

      try {
        // The parser handles the language, not the preprocessor.
        parser.parse(body.replace(/^#version.*$/m, ''));
      } catch (error) {
        failures += 1;
        console.error(`FAIL  ${label}  ${String(error.message).split('\n')[0]}`);
      }
    });
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} shader problem(s) across ${checked} pass(es)`);
  process.exit(1);
}

console.log(`shaders ok — ${checked} pass(es) checked`);
