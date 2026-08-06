/**
 * Node-only helpers. Imported from `@dotkey/core/node` so the browser entry
 * point stays free of `node:` builtins.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import {
  KeynoteDocument,
  parseKeynoteFiles,
  parseKeynoteSync,
  type ParseOptions,
} from './index.js';

/**
 * Read a `.key` file from disk. Handles both the zipped single-file form and
 * the expanded package directory Keynote writes when "Save as package" is on.
 */
export async function readKeynoteFile(
  path: string,
  options: ParseOptions = {},
): Promise<KeynoteDocument> {
  const info = await stat(path);
  if (info.isDirectory()) return parseKeynoteFiles(await readPackageDirectory(path), options);
  return parseKeynoteSync(await readFile(path), options);
}

async function readPackageDirectory(root: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) return walk(full);
        if (!entry.isFile()) return;
        // Package members are addressed with forward slashes, like zip entries.
        files.set(relative(root, full).split(sep).join('/'), await readFile(full));
      }),
    );
  };

  await walk(root);
  return files;
}
