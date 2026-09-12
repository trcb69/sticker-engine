import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp, pdf } from './fixtures/app.js';
import { createSocketTransport, createPrinterClient, parseHostStatus } from '../src/net/printer.js';
import { createPrintQueue } from '../src/net/printQueue.js';
import { createAuditLog } from '../src/audit/auditLog.js';
import { PrinterUnreachableError, UnknownPrinterError } from '../src/errors.js';
import { EventEmitter } from 'node:events';

/* -- Transport ------------------------------------------------------------ */

/** A socket stand-in. No network is touched anywhere in this file. */
function fakeSocket({ failWith = null, reply = null, neverConnect = false } = {}) {
  const socket = new EventEmitter();
  socket.written = [];
  socket.destroyed = false;
  socket.setTimeout = (ms) => { socket.timeoutMs = ms; };
  socket.destroy = () => { socket.destroyed = true; };
  socket.write = (payload, encoding, callback) => {
    socket.written.push(payload);
    setImmediate(() => {
      callback(failWith);
      if (!failWith && reply) setImmediate(() => socket.emit('data', Buffer.from(reply, 'binary')));
    });
    return true;
  };
  if (!neverConnect) setImmediate(() => socket.emit('connect'));
  return socket;
}

const printer = { host: '10.0.0.5', port: 9100, dpi: 203 };

test('a job is written to the socket and the socket is closed', async () => {
  const socket = fakeSocket();
  const transport = createSocketTransport({ connect: () => socket });
  await transport.send(printer, '^XA^XZ');
  assert.deepEqual(socket.written, ['^XA^XZ']);
  assert.equal(socket.destroyed, true, 'no socket is left open');
});

test('an unreachable printer names the address rather than the errno', async () => {
  const socket = fakeSocket({ neverConnect: true });
  const transport = createSocketTransport({ connect: () => socket });
  const promise = transport.send(printer, '^XA^XZ');
  setImmediate(() => socket.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })));
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof PrinterUnreachableError);
    assert.match(error.message, /10\.0\.0\.5:9100/);
    assert.ok(!/ECONNREFUSED/.test(error.message), 'the errno stays in the detail');
    assert.equal(error.detail, 'ECONNREFUSED');
    return true;
  });
});

test('a connect timeout says what to check', async () => {
  const socket = fakeSocket({ neverConnect: true });
  const transport = createSocketTransport({ connect: () => socket, connectTimeoutMs: 5000 });
  const promise = transport.send(printer, '^XA^XZ');
  setImmediate(() => socket.emit('timeout'));
  await assert.rejects(promise, /switched on and on the network/);
});

test('a write that fails after connecting is reported as its own failure', async () => {
  const socket = fakeSocket({ failWith: new Error('EPIPE') });
  const transport = createSocketTransport({ connect: () => socket });
  await assert.rejects(
    transport.send(printer, '^XA^XZ'),
    /accepted the connection but not the data/,
  );
});

/* -- Host status ---------------------------------------------------------- */

test('~HS is parsed into the fields that mean something', () => {
  const status = parseHostStatus(
    '\x02030,0,0,0331,000,0,0,0,000,0,0,0\x03\r\n'
    + '\x02000,0,0,0,0,2,6,0,00000000,1,000\x03\r\n'
    + '\x021234,0\x03\r\n',
  );
  assert.equal(status.paperOut, false);
  assert.equal(status.paused, false);
  assert.equal(status.labelLengthDots, 331, 'field 4 of string 1 is the label length');
  assert.equal(status.printMode, undefined, 'only fields that change behaviour are lifted');
  assert.equal(status.raw.length, 3);
});

test('the conditions that stop a run are surfaced', () => {
  const status = parseHostStatus(
    '\x02030,1,0,0331,000,0,0,0,000,0,0,1\x03\r\n'
    + '\x02000,0,1,1,0,2,6,0,00000042,1,002\x03\r\n',
  );
  assert.equal(status.paperOut, true);
  assert.equal(status.overTemperature, true, 'weak bars are about to start');
  assert.equal(status.headUp, true);
  assert.equal(status.ribbonOut, true);
  assert.equal(status.labelsRemaining, 42);
  assert.equal(status.graphicsStored, 2);
});

test('a printer that ignores ~HS is reported as unknown, not as broken', async () => {
  // Many networked Zebras never answer this. Treating silence as a fault would
  // block printing on perfectly healthy hardware.
  const client = createPrinterClient({
    transport: { async send() {}, async ask() { return ''; } },
    printers: { wh1: printer },
  });
  const status = await client.status('wh1');
  assert.equal(status.answered, false);
  assert.equal(status.reachable, true, 'the connection worked');
  assert.match(status.detail, /Many networked Zebras never do; this is not a fault/);
});

test('an unreachable printer is distinguished from a silent one', async () => {
  const client = createPrinterClient({
    transport: { async send() {}, async ask() { throw new PrinterUnreachableError('no route'); } },
    printers: { wh1: printer },
  });
  const status = await client.status('wh1');
  assert.equal(status.reachable, false);
});

/* -- Logo presence -------------------------------------------------------- */

test('the logo is sent when the printer says it is missing', async () => {
  const sent = [];
  const client = createPrinterClient({
    transport: { async send(_p, payload) { sent.push(payload); }, async ask() { return 'E:OTHER.GRF\r\n'; } },
    printers: { wh1: printer },
    logoZpl: '~DGR:LOGO.GRF,4,1,\nFFFF\n',
  });
  assert.equal(await client.ensureGraphic('wh1'), 'sent');
  assert.equal(sent.length, 1);
  assert.match(sent[0], /~DGR:LOGO\.GRF/);
});

test('the logo is not resent when it is already there', async () => {
  const sent = [];
  const client = createPrinterClient({
    transport: { async send(_p, payload) { sent.push(payload); }, async ask() { return 'R:LOGO.GRF 002592\r\n'; } },
    printers: { wh1: printer },
    logoZpl: '~DG...',
  });
  assert.equal(await client.ensureGraphic('wh1'), 'present');
  assert.deepEqual(sent, []);
});

test('a printer that will not answer the directory query gets the logo anyway', async () => {
  // A missing ^XG target prints a blank space and reports nothing, so the
  // labels come out looking almost right. A few kilobytes once is cheap next
  // to a pallet of logo-less labels.
  const sent = [];
  const client = createPrinterClient({
    transport: { async send(_p, payload) { sent.push(payload); }, async ask() { return ''; } },
    printers: { wh1: printer },
    logoZpl: '~DG...',
  });
  assert.equal(await client.ensureGraphic('wh1'), 'unverifiable');
  assert.equal(sent.length, 1);
});

test('the check runs once per printer, not once per label', async () => {
  let asks = 0;
  const client = createPrinterClient({
    transport: { async send() {}, async ask() { asks += 1; return 'R:LOGO.GRF'; } },
    printers: { wh1: printer },
    logoZpl: '~DG...',
  });
  await client.ensureGraphic('wh1');
  await client.ensureGraphic('wh1');
  assert.equal(asks, 1);
  client.forget('wh1');
  await client.ensureGraphic('wh1');
  assert.equal(asks, 2, 'and can be forgotten after a power cycle');
});

test('an unknown printer lists the ones that are configured', () => {
  const client = createPrinterClient({
    transport: { async send() {}, async ask() { return ''; } },
    printers: { wh1: printer, wh2: printer },
  });
  assert.throws(() => client.resolve('nope'), (error) => {
    assert.ok(error instanceof UnknownPrinterError);
    assert.match(error.message, /Configured: wh1, wh2/);
    return true;
  });
});

/* -- Queue ---------------------------------------------------------------- */

test('jobs to one printer run one at a time', async () => {
  // Two operators pressing Print at once would otherwise interleave their ZPL
  // on the wire, and a ^XA arriving inside another label's field data produces
  // garbage on both runs with nothing to show for it.
  const queue = createPrintQueue();
  const order = [];
  const slow = (name, ms) => queue.submit('wh1', async () => {
    order.push(`${name}:start`);
    await new Promise((resolve) => setTimeout(resolve, ms));
    order.push(`${name}:end`);
  });
  await Promise.all([slow('a', 20), slow('b', 1)]);
  assert.deepEqual(order, ['a:start', 'a:end', 'b:start', 'b:end']);
});

test('two printers work at the same time', async () => {
  const queue = createPrintQueue();
  const order = [];
  await Promise.all([
    queue.submit('wh1', async () => { await new Promise((r) => setTimeout(r, 20)); order.push('wh1'); }),
    queue.submit('wh2', async () => { order.push('wh2'); }),
  ]);
  assert.deepEqual(order, ['wh2', 'wh1'], 'wh2 did not wait for wh1');
});

test('a failed job does not deadlock the printer for everyone after it', async () => {
  const queue = createPrintQueue();
  const failed = queue.submit('wh1', async () => { throw new Error('printer on fire'); });
  await assert.rejects(failed, /on fire/);
  assert.equal(await queue.submit('wh1', async () => 'fine'), 'fine');
});

/* -- Audit log ------------------------------------------------------------ */

function memoryAudit() {
  const lines = [];
  return {
    lines,
    log: createAuditLog({
      path: '/audit.jsonl',
      now: () => '2026-09-06T00:00:00.000Z',
      io: {
        mkdir: async () => {},
        appendFile: async (_p, line) => lines.push(line),
        readFile: async () => {
          if (lines.length === 0) { const e = new Error('x'); e.code = 'ENOENT'; throw e; }
          return lines.join('');
        },
      },
    }),
  };
}

test('the log is append-only JSON lines', async () => {
  const { lines, log } = memoryAudit();
  await log.append({ event: 'label.printed', batchCode: 'JUR260725', operator: 'hadhee' });
  await log.append({ event: 'label.printed', batchCode: 'JUR260726', operator: 'hadhee' });
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => line.endsWith('\n')));
  assert.equal(JSON.parse(lines[0]).at, '2026-09-06T00:00:00.000Z');
});

test('a missing log reads as empty rather than throwing', async () => {
  assert.deepEqual(await memoryAudit().log.read(), []);
});

test('a truncated final line does not lose the whole log', async () => {
  // An interrupted write costs the last line. It must not cost the rest.
  const { lines, log } = memoryAudit();
  await log.append({ event: 'label.printed', batchCode: 'A' });
  lines.push('{"event":"label.print');
  const entries = await log.read();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].batchCode, 'A');
});

test('history for a batch code is case-insensitive', async () => {
  const { log } = memoryAudit();
  await log.append({ event: 'label.printed', batchCode: 'JUR260725' });
  await log.append({ event: 'run.printed', batchCode: 'JUR260725' });
  const history = await log.historyFor('jur260725');
  assert.equal(history.length, 1, 'only actual label prints count');
});
