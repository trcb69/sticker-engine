/**
 * Anchor-based text extraction helpers.
 *
 * These deliberately do not use column positions. `pdftotext -layout` spacing
 * shifts whenever a value grows or a document template is re-laid-out, so any
 * parser keyed to a character offset breaks on the first long customer name.
 * Instead every value is found by locating its printed label and reading what
 * follows it.
 */

/**
 * @param {string} text
 * @returns {string[]} lines with trailing whitespace stripped, blanks kept
 */
export function toLines(text) {
  return text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/\s+$/, ''));
}

/** @param {string} value */
export function collapse(value) {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Locate a labelled value.
 *
 * Reads the remainder of the label's own line. When that is empty the value
 * sits on the following line, which is how `pdftotext` renders a two-column
 * layout whose right column wrapped.
 *
 * @param {string[]} lines
 * @param {string|RegExp} label
 * @param {{ from?: number, continuation?: boolean, stopAt?: RegExp }} [options]
 * @returns {{ value: string, line: number }|null}
 */
export function valueAfter(lines, label, options = {}) {
  const start = options.from ?? 0;
  const matcher = label instanceof RegExp
    ? label
    : new RegExp(escapeRegExp(label).replace(/\s+/g, '\\s*'), 'i');

  for (let i = start; i < lines.length; i += 1) {
    const found = matcher.exec(lines[i]);
    if (!found) continue;

    let value = collapse(lines[i].slice(found.index + found[0].length).replace(/^[:\s]+/, ''));
    let last = i;

    if (value === '') {
      const next = nextNonBlank(lines, i + 1);
      if (next === -1) return null;
      value = collapse(lines[next]);
      last = next;
    }

    // A value that wrapped continues on following lines until a blank line or
    // something that looks like the next label.
    if (options.continuation) {
      for (let j = last + 1; j < lines.length; j += 1) {
        const candidate = lines[j];
        if (candidate.trim() === '') break;
        if (options.stopAt?.test(candidate)) break;
        if (/\s:\s*$|\s:\s\S/.test(candidate)) break;
        value = `${value} ${collapse(candidate)}`;
        last = j;
      }
    }

    return { value: collapse(value), line: last };
  }
  return null;
}

/**
 * @param {string[]} lines
 * @param {number} from
 * @returns {number} index of the next non-blank line, or -1
 */
export function nextNonBlank(lines, from) {
  for (let i = from; i < lines.length; i += 1) {
    if (lines[i].trim() !== '') return i;
  }
  return -1;
}

/**
 * Find a table by its header row.
 *
 * A header is identified by the presence of every required token, in order,
 * possibly spread across the header line and the one after it — column
 * captions in these documents wrap onto two lines.
 *
 * @param {string[]} lines
 * @param {string[]} tokens
 * @param {{ from?: number }} [options]
 * @returns {{ headerLine: number, bodyStart: number }|null}
 */
export function findTable(lines, tokens, options = {}) {
  const start = options.from ?? 0;
  for (let i = start; i < lines.length; i += 1) {
    const oneLine = lines[i].toUpperCase();
    const twoLines = `${oneLine} ${(lines[i + 1] ?? '').toUpperCase()}`;
    const threeLines = `${twoLines} ${(lines[i + 2] ?? '').toUpperCase()}`;
    for (const [span, text] of [[1, oneLine], [2, twoLines], [3, threeLines]]) {
      if (containsInOrder(text, tokens)) {
        return { headerLine: i, bodyStart: skipBlank(lines, i + span) };
      }
    }
  }
  return null;
}

/**
 * @param {string} haystack
 * @param {string[]} tokens
 * @returns {boolean}
 */
function containsInOrder(haystack, tokens) {
  let cursor = 0;
  for (const token of tokens) {
    const at = haystack.indexOf(token.toUpperCase(), cursor);
    if (at === -1) return false;
    cursor = at + token.length;
  }
  return true;
}

/**
 * @param {string[]} lines
 * @param {number} from
 * @returns {number}
 */
function skipBlank(lines, from) {
  let i = from;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  return i;
}

/**
 * Collect table rows until a terminator.
 *
 * Two things make this harder than splitting on newlines.
 *
 * First, a row's ordinal is not simply "a line starting with digits". In these
 * documents the order number wraps, so the continuation line begins `0040` —
 * which reads as row forty. Rows are therefore only started by the ordinal the
 * sequence expects next; anything else is a continuation.
 *
 * Second, a continuation's cells cannot be merged by index, because the
 * columns it wraps into are not the columns it appears to occupy: the wrapped
 * `0040` is the second cell on its line but belongs to the second column,
 * while `kg kg kg` are cells two through four belonging to columns three
 * through five. Fragments are matched to their parent column by horizontal
 * overlap instead. That is alignment within a single table, not a hard-coded
 * offset, and it survives the table moving or a column widening.
 *
 * @param {string[]} lines
 * @param {number} bodyStart
 * @param {{ terminators?: RegExp[], maxBlankRun?: number }} [options]
 * @returns {{ ordinal: number, cells: string[], raw: string }[]}
 */
export function collectRows(lines, bodyStart, options = {}) {
  const terminators = options.terminators ?? [];
  const maxBlankRun = options.maxBlankRun ?? 3;

  /** @type {{ ordinal: number, spans: {text: string, start: number, end: number}[], raw: string }[]} */
  const rows = [];
  let blankRun = 0;
  let expected = 1;

  for (let i = bodyStart; i < lines.length; i += 1) {
    const line = lines[i];

    if (line.trim() === '') {
      blankRun += 1;
      if (blankRun >= maxBlankRun) break;
      continue;
    }
    blankRun = 0;
    if (terminators.some((t) => t.test(line))) break;

    const spans = splitSpans(line);
    if (spans.length === 0) continue;

    const startsRow = /^\d+$/.test(spans[0].text) && Number(spans[0].text) === expected;
    if (startsRow) {
      rows.push({ ordinal: expected, spans: spans.slice(1), raw: line.trim() });
      expected += 1;
      continue;
    }

    if (rows.length > 0) {
      const previous = rows[rows.length - 1];
      mergeSpans(previous.spans, spans);
      previous.raw = `${previous.raw} ${line.trim()}`;
    }
  }

  return rows.map((row) => ({
    ordinal: row.ordinal,
    cells: row.spans.map((span) => span.text),
    raw: row.raw,
  }));
}

/**
 * Split a line into cells on runs of two or more spaces, keeping each cell's
 * horizontal span so continuations can be aligned to it.
 * @param {string} line
 * @returns {{ text: string, start: number, end: number }[]}
 */
export function splitSpans(line) {
  /** @type {{ text: string, start: number, end: number }[]} */
  const spans = [];
  // A cell is a run of tokens separated by single spaces. Two or more spaces
  // end it, which is how `pdftotext -layout` marks a column boundary.
  const pattern = /\S+(?: \S+)*/g;
  let match = pattern.exec(line);
  while (match !== null) {
    spans.push({ text: match[0].trim(), start: match.index, end: match.index + match[0].length });
    match = pattern.exec(line);
  }
  return spans.filter((span) => span.text !== '');
}

/**
 * Split a line into cell text only.
 * @param {string} line
 * @returns {string[]}
 */
export function splitCells(line) {
  return splitSpans(line).map((span) => span.text);
}

/**
 * Merge a continuation line's fragments into the row above, matching each to
 * the column it overlaps.
 * @param {{text: string, start: number, end: number}[]} target
 * @param {{text: string, start: number, end: number}[]} extra
 */
function mergeSpans(target, extra) {
  for (const fragment of extra) {
    const column = bestOverlap(target, fragment);
    if (column === -1) {
      // Nothing to attach to. The description is the only column wide enough
      // to wrap without overlapping anything, so it is the safe home.
      if (target.length > 0) target[0] = joinFragment(target[0], fragment);
      continue;
    }
    target[column] = joinFragment(target[column], fragment);
  }
}

/**
 * @param {{start: number, end: number}[]} spans
 * @param {{start: number, end: number}} fragment
 * @returns {number} index of the best-overlapping span, or -1
 */
function bestOverlap(spans, fragment) {
  let best = -1;
  let bestWidth = 0;
  spans.forEach((span, index) => {
    const width = Math.min(span.end, fragment.end) - Math.max(span.start, fragment.start);
    if (width > bestWidth) { bestWidth = width; best = index; }
  });
  return best;
}

/** A cell that is one unbroken token, so a wrapped fragment joins onto it. */
const SINGLE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9\-./]*$/;

/**
 * Join a wrapped fragment onto its column.
 *
 * An identifier split across lines — `RSMSO2609` then `0040` — must rejoin
 * without a space or the order number is wrong. Prose that wrapped keeps its
 * space. The distinguishing test is whether both halves are single tokens.
 *
 * @param {{text: string, start: number, end: number}} span
 * @param {{text: string, start: number, end: number}} fragment
 * @returns {{text: string, start: number, end: number}}
 */
function joinFragment(span, fragment) {
  const glue = SINGLE_TOKEN.test(span.text) && SINGLE_TOKEN.test(fragment.text) ? '' : ' ';
  return {
    text: collapse(`${span.text}${glue}${fragment.text}`),
    start: Math.min(span.start, fragment.start),
    end: Math.max(span.end, fragment.end),
  };
}

/**
 * Read the values sitting underneath a caption, in the caption's own column.
 *
 * The summary band on a Picklist places several captions side by side, each
 * with its value stacked beneath it. A character-window slice picks up the
 * neighbouring column as soon as one value runs long, so cells are selected by
 * how closely their left edge lines up with the caption's instead.
 *
 * @param {string[]} lines
 * @param {string|RegExp} caption
 * @param {{ maxLines?: number, tolerance?: number, from?: number }} [options]
 * @returns {{ values: string[], captionLine: number, column: number }|null}
 */
export function columnBelow(lines, caption, options = {}) {
  const maxLines = options.maxLines ?? 6;
  const tolerance = options.tolerance ?? 4;
  const matcher = caption instanceof RegExp ? caption : new RegExp(escapeRegExp(caption));

  for (let i = options.from ?? 0; i < lines.length; i += 1) {
    const found = matcher.exec(lines[i]);
    if (!found) continue;
    const column = found.index;

    /** @type {string[]} */
    const values = [];
    for (let j = i + 1; j < Math.min(i + 1 + maxLines, lines.length); j += 1) {
      if (lines[j].trim() === '') break;
      const cell = splitSpans(lines[j]).find((span) => Math.abs(span.start - column) <= tolerance);
      if (cell) values.push(cell.text);
    }
    return { values, captionLine: i, column };
  }
  return null;
}

/**
 * Read a value that occupies one column across several lines, starting from a
 * given line rather than from a caption above it.
 *
 * Right-hand columns wrap upward as well as downward once `pdftotext` lays
 * them out: a value can begin on the line above its own label. `before` allows
 * for that.
 *
 * @param {string[]} lines
 * @param {number} atLine
 * @param {number} column
 * @param {{ before?: number, after?: number, tolerance?: number }} [options]
 * @returns {string[]}
 */
export function columnAround(lines, atLine, column, options = {}) {
  const before = options.before ?? 0;
  const after = options.after ?? 4;
  const tolerance = options.tolerance ?? 4;
  /** @type {string[]} */
  const values = [];

  for (let i = Math.max(0, atLine - before); i <= Math.min(lines.length - 1, atLine + after); i += 1) {
    if (lines[i].trim() === '' && i > atLine) break;
    const cell = splitSpans(lines[i]).find((span) => Math.abs(span.start - column) <= tolerance);
    if (cell) values.push(cell.text);
  }
  return values;
}

/**
 * Parse a quantity such as `0.30 kg` or `1.5` into its parts.
 *
 * `amount` is the numeral exactly as written, because the label prints it that
 * way. `value` is the same thing as a number, used only for arithmetic such as
 * reconciling a Picklist against its own printed total.
 *
 * @param {string} raw
 * @returns {{ amount: string, value: number, uom: string|null }|null}
 */
export function parseQuantity(raw) {
  if (typeof raw !== 'string') return null;
  const match = /(-?\d+(?:[.,]\d+)?)\s*([A-Za-z]+)?/.exec(collapse(raw));
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  return { amount: match[1], value, uom: match[2] ? match[2].toLowerCase() : null };
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
