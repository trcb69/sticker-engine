#!/usr/bin/env node
/**
 * Regenerate the golden fixtures.
 *
 * Run deliberately, never as part of the test run: a golden file that
 * regenerates itself cannot detect a regression.
 *
 *   npm run golden        # then read the diff before committing it
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve as resolveTemplate } from '../src/template/schema.js';
import { emit } from '../src/render/zpl.js';
import { referenceContext } from '../test/fixtures/context.js';
import { buildPipelineZpl } from '../test/fixtures/pipeline.js';

const raw = JSON.parse(await readFile(new URL('../src/template/label-4x1.json', import.meta.url), 'utf8'));

const single = emit(resolveTemplate(raw, 203), referenceContext).zpl;
await writeFile(new URL('../test/fixtures/golden-4x1-203.zpl', import.meta.url), single, 'utf8');

const pipeline = await buildPipelineZpl();
await writeFile(new URL('../test/fixtures/golden-pipeline-203.zpl', import.meta.url), pipeline, 'utf8');

process.stdout.write(
  `golden-4x1-203.zpl       ${single.split('\n').length - 1} lines\n`
  + `golden-pipeline-203.zpl  ${pipeline.split('\n').length - 1} lines\n`,
);
