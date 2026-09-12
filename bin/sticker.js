#!/usr/bin/env node
/**
 * Headless CLI.
 *
 * Everything the web interface does, without the web interface: parse a
 * document, build a job, emit ZPL, print, validate a template, regenerate the
 * logo. Useful for debugging a document that will not parse, for scripting a
 * reprint, and for checking a template change before it reaches an operator.
 *
 * Exit codes are distinct so a shell script can tell what went wrong:
 *
 *   0  success
 *   2  usage error — wrong arguments
 *   3  the document could not be read or parsed
 *   4  printing failed
 *   5  the template or image is invalid
 *   1  anything else, which is a bug
 */

import { access, readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { AppError } from '../src/errors.js';
import { loadConfig } from '../src/config.js';
import { createExtractor, createPopplerReader } from '../src/ingest/extract.js';
import { parsePicklist } from '../src/ingest/parsePicklist.js';
import { parseSampleNote } from '../src/ingest/parseSampleNote.js';
import { parseSalesOrder } from '../src/ingest/parseSalesOrder.js';
import { joinToJob } from '../src/ingest/join.js';
import { enrichJob } from '../src/enrich/enrichJob.js';
import { resolve as resolveTemplate, validateTemplate } from '../src/template/schema.js';
import { emit } from '../src/render/zpl.js';
import { guard, isPrintable } from '../src/render/guard.js';
import { renderContext } from '../src/http/serialise.js';
import { createPrinterClient, createSocketTransport } from '../src/net/printer.js';
import { createPrinterProbe } from '../src/http/probes.js';
import { decodePng, toGraphicCommand, toMonochrome } from '../src/logo.js';

// Piping into `head` closes stdout early. Without this the process dies with
// an unhandled EPIPE and a stack trace, which looks like a crash when it is
// just the reader losing interest.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(EXIT.OK);
  throw error;
});

export const EXIT = Object.freeze({
  OK: 0, BUG: 1, USAGE: 2, DOCUMENT: 3, PRINT: 4, INVALID: 5,
});

/** Errors that mean "the document is the problem", not "the tool is". */
const DOCUMENT_CODES = new Set([
  'DOCUMENT_UNRECOGNISED', 'DOCUMENT_UNREADABLE', 'DATE_UNPARSEABLE', 'JOIN_FAILED',
]);
const PRINT_CODES = new Set([
  'PRINTER_UNREACHABLE', 'PRINTER_WRITE_FAILED', 'PRINTER_UNKNOWN', 'REPRINT_REASON_REQUIRED',
]);
const INVALID_CODES = new Set(['TEMPLATE_INVALID', 'IMAGE_UNREADABLE', 'CONFIG_INVALID']);

const PARSERS = { picklist: parsePicklist, sampleNote: parseSampleNote, salesOrder: parseSalesOrder };

const USAGE = `sticker — thermal label tooling

  sticker parse <file.pdf>                      read a document and print the parsed JSON
  sticker job <picklist.pdf> [sampleNote.pdf]   build a job and print it as JSON
  sticker zpl <job.json> --line N [--dpi 203]   emit ZPL for one line
  sticker print <job.json> --printer NAME       send every ready line to a printer
                           [--line N] [--dpi 203] [--operator NAME] [--reason TEXT]
  sticker printers                              list configured printers and probe each one
  sticker status --printer NAME                 ask a printer how it is (~HS)
  sticker validate-template <template.json>     check a template and report its slots
  sticker logo <image.png> [--size 144]         convert a logo to a ~DG command
                           [--knockout] [--object R:LOGO.GRF] [--out file.zpl]

  --json            machine-readable output where a command supports it
  --help            this text
`;

/**
 * @param {string[]} argv
 * @returns {Promise<number>} exit code
 */
export async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return command ? EXIT.OK : EXIT.USAGE;
  }

  const { positional, flags } = parseArgs(rest);

  try {
    switch (command) {
      case 'parse': return await cmdParse(positional, flags);
      case 'job': return await cmdJob(positional, flags);
      case 'zpl': return await cmdZpl(positional, flags);
      case 'print': return await cmdPrint(positional, flags);
      case 'printers': return await cmdPrinters(flags);
      case 'status': return await cmdStatus(flags);
      case 'validate-template': return await cmdValidateTemplate(positional);
      case 'logo': return await cmdLogo(positional, flags);
      default:
        fail(`Unknown command "${command}".`);
        process.stderr.write(USAGE);
        return EXIT.USAGE;
    }
  } catch (error) {
    return report(error);
  }
}

/* -- Commands ------------------------------------------------------------- */

async function cmdParse([file], flags) {
  if (!file) return usage('parse needs a file: sticker parse picklist.pdf');
  await mustExist(file);
  const config = loadConfig();
  const extracted = await extractorFor(config).extract(file);
  const parsed = PARSERS[extracted.kind](extracted.layoutText, { dateOrder: config.dateOrder });

  if (flags.json) {
    out({ kind: extracted.kind, pages: extracted.pageCount, document: parsed });
    return EXIT.OK;
  }

  process.stdout.write(`${basename(file)} — ${extracted.kind}, ${extracted.pageCount} page(s)\n\n`);
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'lines' || key === 'warnings') continue;
    process.stdout.write(`  ${key.padEnd(16)} ${describeField(value)}\n`);
  }
  process.stdout.write(`\n  ${parsed.lines.length} line(s)\n`);
  for (const line of parsed.lines) {
    process.stdout.write(`    ${String(line.index).padStart(2)}  ${describeField(line.description)}\n`);
  }
  warn(parsed.warnings);
  return EXIT.OK;
}

async function cmdJob(files, flags) {
  if (files.length === 0) return usage('job needs at least a picklist: sticker job picklist.pdf');
  for (const file of files) await mustExist(file);
  const config = loadConfig();
  const extractor = extractorFor(config);

  /** @type {Record<string, object>} */
  const documents = {};
  for (const file of files) {
    const extracted = await extractor.extract(file);
    documents[extracted.kind] = PARSERS[extracted.kind](extracted.layoutText, {
      dateOrder: config.dateOrder,
    });
  }

  const joined = joinToJob(documents);
  const enriched = enrichJob(joined.job, { config });
  const payload = {
    job: enriched.job,
    warnings: joined.warnings,
    enrichWarnings: enriched.warnings,
    buckets: joined.buckets,
  };

  if (flags.out) {
    await writeFile(flags.out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    process.stdout.write(`Wrote ${flags.out}\n`);
    return EXIT.OK;
  }
  out(payload);
  return EXIT.OK;
}

async function cmdZpl([file], flags) {
  if (!file) return usage('zpl needs a job file: sticker zpl job.json --line 1');
  const { job } = await readJob(file);
  const dpi = dpiFrom(flags);
  const line = lineFrom(job, flags.line);
  if (!line) return usage(`This job has no line ${flags.line ?? '(unspecified)'}.`);

  const { zpl, placed } = emit(templateAt(dpi), renderContext(job, line), {
    copies: Number(flags.copies ?? line.copies ?? 1),
  });
  const warnings = guard(placed);
  process.stdout.write(zpl);
  warn(warnings.filter((w) => w.severity !== 'info').map((w) => `${w.slotId}: ${w.message}`));
  return isPrintable(warnings) ? EXIT.OK : EXIT.INVALID;
}

async function cmdPrint([file], flags) {
  if (!file) return usage('print needs a job file: sticker print job.json --printer wh1');
  if (!flags.printer) return usage('print needs --printer NAME. See STICKER_PRINTERS.');

  const config = loadConfig();
  const { job } = await readJob(file);
  const dpi = dpiFrom(flags);

  const lines = flags.line
    ? [lineFrom(job, flags.line)].filter(Boolean)
    : job.lines.filter((line) => line.status === 'ready');
  if (lines.length === 0) {
    fail('Nothing to print: no line on this job is ready.');
    return EXIT.USAGE;
  }

  const logoZpl = flags.logo ? await readFile(flags.logo, 'utf8') : null;
  const client = createPrinterClient({
    transport: createSocketTransport(),
    printers: config.printers,
    logoZpl,
    logger: { info: () => {}, warn: (entry) => fail(entry.error ?? '') },
  });

  await client.ensureGraphic(flags.printer);
  const payload = lines
    .map((line) => emit(templateAt(dpi), renderContext(job, line), {
      copies: line.copies ?? 1,
    }).zpl)
    .join('');
  await client.print(flags.printer, payload);

  const labels = lines.reduce((sum, line) => sum + (line.copies ?? 1), 0);
  process.stdout.write(`Sent ${labels} label(s) on ${lines.length} line(s) to ${flags.printer}.\n`);
  // The CLI writes bytes to a socket. It cannot see a label come out, and it
  // deliberately does not claim to — verification is a person with a scanner.
  process.stdout.write('Scan one printed label and check it reads before releasing the run.\n');
  return EXIT.OK;
}

/**
 * List printers and check each one answers on port 9100.
 *
 * The first thing to run on a new install. A printer that does not answer here
 * will not answer for the web interface either, and the usual cause is that the
 * machine running this cannot route to the factory network at all.
 */
async function cmdPrinters(flags) {
  const config = loadConfig();
  const names = Object.keys(config.printers);
  if (names.length === 0) {
    fail('No printers are configured. Set STICKER_PRINTERS=name=host:port,dpi');
    return EXIT.USAGE;
  }

  const probe = createPrinterProbe({ printers: config.printers, timeoutMs: 3000 });
  const result = await probe();
  if (flags.json) { out({ printers: config.printers, reachable: result.printers }); return EXIT.OK; }

  process.stdout.write(`${names.length} printer(s) configured\n\n`);
  for (const name of names) {
    const printer = config.printers[name];
    const ok = result.printers[name];
    process.stdout.write(`  ${ok ? 'up  ' : 'DOWN'}  ${name.padEnd(12)} `
      + `${printer.host}:${printer.port}  ${printer.dpi} dpi\n`);
  }
  if (!result.ok) {
    process.stdout.write('\nA printer that does not answer is usually a routing problem rather '
      + 'than a printer problem: check this machine is on the same network as the printer.\n');
    return EXIT.PRINT;
  }
  return EXIT.OK;
}

/**
 * Ask a printer how it is. Answers are best-effort — see the ~HS caveat.
 */
async function cmdStatus(flags) {
  if (!flags.printer) return usage('status needs --printer NAME. Try: sticker printers');
  const config = loadConfig();
  const client = createPrinterClient({
    transport: createSocketTransport({ connectTimeoutMs: 4000 }),
    printers: config.printers,
  });

  const status = await client.status(String(flags.printer));
  if (flags.json) { out(status); return EXIT.OK; }

  if (!status.reachable) {
    fail(`${flags.printer} is not reachable. ${status.detail}`);
    return EXIT.PRINT;
  }
  if (!status.answered) {
    process.stdout.write(`${flags.printer}: reachable, but silent.\n  ${status.detail}\n`);
    return EXIT.OK;
  }

  const flags_ = [
    ['paper out', status.paperOut], ['paused', status.paused], ['head up', status.headUp],
    ['ribbon out', status.ribbonOut], ['over temperature', status.overTemperature],
    ['buffer full', status.bufferFull],
  ];
  process.stdout.write(`${flags.printer}: answered\n`);
  for (const [label, on] of flags_) {
    process.stdout.write(`  ${on ? 'YES' : 'no '}  ${label}\n`);
  }
  process.stdout.write(`  ${String(status.labelLengthDots).padStart(4)}  label length in dots\n`);
  process.stdout.write(`  ${String(status.graphicsStored).padStart(4)}  graphics stored in memory\n`);
  return flags_.some(([, on]) => on) ? EXIT.PRINT : EXIT.OK;
}

async function cmdValidateTemplate([file]) {
  if (!file) return usage('validate-template needs a file.');
  const template = JSON.parse(await readFile(file, 'utf8'));
  validateTemplate(template);

  process.stdout.write(`${basename(file)} is valid — ${template.slots.length} slots, `
    + `authored at ${template.designDpi} dpi, ${template.widthIn}x${template.heightIn} in\n\n`);
  for (const dpi of [203, 300, 600]) {
    const resolved = resolveTemplate(template, dpi);
    process.stdout.write(`  ${String(dpi).padStart(3)} dpi  `
      + `${Math.round(resolved.widthIn * dpi)}x${Math.round(resolved.heightIn * dpi)} dots\n`);
  }
  process.stdout.write('\n');
  for (const slot of template.slots) {
    process.stdout.write(`  ${slot.id.padEnd(10)} ${slot.type.padEnd(8)} `
      + `x=${slot.x ?? '(flow)'} y=${slot.y}\n`);
  }
  return EXIT.OK;
}

async function cmdLogo([file], flags) {
  if (!file) return usage('logo needs an image: sticker logo logo.png --size 144');
  const size = Number(flags.size ?? 144);
  if (!Number.isInteger(size) || size < 32 || size > 1200) {
    return usage('--size must be a whole number of dots between 32 and 1200.');
  }

  const image = decodePng(await readFile(file));
  const mono = toMonochrome(image, size, { knockout: Boolean(flags.knockout) });
  const object = flags.object ?? (flags.knockout ? 'R:LOGOKO.GRF' : 'R:LOGO.GRF');
  const command = toGraphicCommand(mono, object);

  if (flags.out) {
    await writeFile(flags.out, command.zpl, 'utf8');
    process.stdout.write(`Wrote ${flags.out} — ${object}, ${size}x${size} dots, `
      + `${command.bytes} bytes, ${(mono.coverage * 100).toFixed(1)}% black\n`);
    if (mono.coverage > 0.5) {
      process.stdout.write('That is a lot of heat per label. Try --knockout and compare a '
        + 'printed sample before committing.\n');
    }
    return EXIT.OK;
  }
  process.stdout.write(command.zpl);
  return EXIT.OK;
}

/* -- Helpers -------------------------------------------------------------- */

/**
 * @param {string[]} argv
 * @returns {{ positional: string[], flags: Record<string, string|boolean> }}
 */
export function parseArgs(argv) {
  const positional = [];
  /** @type {Record<string, string|boolean>} */
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) { positional.push(token); continue; }
    const [name, inline] = token.slice(2).split('=');
    if (inline !== undefined) { flags[name] = inline; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { flags[name] = true; continue; }
    flags[name] = next;
    i += 1;
  }
  return { positional, flags };
}

/**
 * A file that is not there is a usage mistake, not an unreadable document.
 * Letting poppler report it produces "may not be a valid PDF", which sends
 * whoever ran it looking in the wrong place.
 * @param {string} file
 */
async function mustExist(file) {
  try {
    await access(file);
  } catch {
    const error = new Error(`No such file: ${file}`);
    error.code = 'ENOENT';
    error.path = file;
    throw error;
  }
}

function extractorFor(config) {
  return createExtractor({ readers: [createPopplerReader({ binDir: config.popplerBinDir })] });
}

async function readJob(file) {
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  return parsed.job ? parsed : { job: parsed };
}

function templateAt(dpi) {
  const source = templateSource ?? (templateSource = JSON.parse(templateText));
  return resolveTemplate(source, dpi);
}

function lineFrom(job, index) {
  if (index === undefined) return job.lines[0];
  return job.lines.find((line) => line.index === Number(index));
}

function dpiFrom(flags) {
  const dpi = Number(flags.dpi ?? 203);
  if (![203, 300, 600].includes(dpi)) {
    throw new AppError(`Print resolution must be 203, 300 or 600. Received "${flags.dpi}".`);
  }
  return dpi;
}

/** @param {unknown} value */
function describeField(value) {
  if (value && typeof value === 'object' && 'provenance' in value) {
    return value.value === null ? `— (${value.note ?? 'missing'})` : String(value.value);
  }
  return String(value);
}

function out(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function warn(messages) {
  for (const message of messages ?? []) process.stderr.write(`warning: ${message}\n`);
}

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
}

function usage(message) {
  fail(message);
  return EXIT.USAGE;
}

/**
 * Map an error to an exit code, showing the operator-safe message and keeping
 * the stack only for genuine bugs.
 * @param {Error} error
 * @returns {number}
 */
export function report(error) {
  if (error instanceof AppError) {
    fail(error.message);
    if (error.detail) process.stderr.write(`  ${error.detail}\n`);
    if (DOCUMENT_CODES.has(error.code)) return EXIT.DOCUMENT;
    if (PRINT_CODES.has(error.code)) return EXIT.PRINT;
    if (INVALID_CODES.has(error.code)) return EXIT.INVALID;
    return EXIT.BUG;
  }
  if (error instanceof SyntaxError) {
    fail(`That file is not valid JSON: ${error.message}`);
    return EXIT.DOCUMENT;
  }
  if (error?.code === 'ENOENT') {
    fail(`No such file: ${error.path}`);
    return EXIT.USAGE;
  }
  fail(error?.message ?? String(error));
  if (error?.stack) process.stderr.write(`${error.stack}\n`);
  return EXIT.BUG;
}

/** @type {object|null} */
let templateSource = null;
const templateText = await readFile(
  new URL('../src/template/label-4x1.json', import.meta.url), 'utf8',
);

// Only run when invoked directly, so the tests can import `main` and drive it.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2));
}
