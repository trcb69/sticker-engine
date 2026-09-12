/**
 * Staged upload storage.
 *
 * Uploaded documents are written to disk rather than held in memory: a job may
 * sit open for half an hour while an operator works through it, and holding
 * every PDF of every concurrent job in the heap is a slow leak waiting to
 * happen. The adapter is injected so nothing above it touches the filesystem
 * directly, which is also what keeps the route tests off disk.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

/**
 * @typedef {object} FileStore
 * @property {(buffer: Buffer, originalName: string) => Promise<string>} stage
 * @property {(path: string) => Promise<void>} remove
 */

/**
 * @param {string} directory
 * @param {{ mkdir?: Function, writeFile?: Function, rm?: Function, id?: () => string }} [io]
 * @returns {FileStore}
 */
export function createDiskFileStore(directory, io = {}) {
  const mkdirImpl = io.mkdir ?? mkdir;
  const writeImpl = io.writeFile ?? writeFile;
  const rmImpl = io.rm ?? rm;
  const id = io.id ?? randomUUID;

  return {
    async stage(buffer, originalName) {
      await mkdirImpl(directory, { recursive: true });
      // The stored name is generated, never taken from the upload. A filename
      // is attacker-controlled input and has no business reaching a path.
      const extension = /\.(pdf|png|jpe?g)$/i.exec(originalName ?? '')?.[0] ?? '';
      const path = join(directory, `${id()}${extension.toLowerCase()}`);
      await writeImpl(path, buffer);
      return path;
    },
    async remove(path) {
      await rmImpl(path, { force: true });
    },
  };
}

/**
 * In-memory equivalent, for tests.
 * @returns {FileStore & { files: Map<string, Buffer> }}
 */
export function createMemoryFileStore() {
  const files = new Map();
  let counter = 0;
  return {
    files,
    async stage(buffer, originalName) {
      counter += 1;
      const path = `/memory/${counter}-${(originalName ?? 'upload').replace(/[^\w.]/g, '_')}`;
      files.set(path, buffer);
      return path;
    },
    async remove(path) {
      files.delete(path);
    },
  };
}
