#!/usr/bin/env node
/**
 * Compiles the vendored iWork `.proto` definitions into a single protobuf.js
 * JSON descriptor, pruned to the subset needed for *rendering*, and emits a
 * matching TSPRegistry table (numeric archive type -> message name).
 *
 * Output: packages/core/src/generated/{schema.json,registry.json,meta.json}
 *
 * Run with `pnpm schema`. The generated files are committed so consumers of the
 * library never need protoc, protobufjs-cli, or a local iWork install.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const protobuf = require('protobufjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = process.env.IWORK_VERSION ?? '14.4';
const PROTO_DIR = path.join(ROOT, 'vendor', 'iwork', VERSION);
const OUT_DIR = path.join(ROOT, 'packages', 'core', 'src', 'generated');

/**
 * Files that only describe things a renderer never reads:
 *  - `*CommandArchives` are undo/redo journal entries
 *  - `TSCEArchives` is the spreadsheet calculation engine
 *  - `*_sos` are the "save-on-server" collaboration delta variants
 * Excluding them roughly halves the descriptor.
 */
const EXCLUDE_FILE = /(CommandArchives|^TSCEArchives|_sos)\.proto$/;

/**
 * Roots of the render graph. Every message reachable from these (through field
 * types, `super` chains and extensions) is kept; everything else is dropped.
 */
const KEEP_ROOTS = [
  'TSP.ArchiveInfo',
  'TSP.PackageMetadata',
  'TSP.DocumentMetadata',
  'TSP.DataMetadataMap',
  'TSA.DocumentArchive',
  'KN.DocumentArchive',
  'KN.ShowArchive',
  'KN.ThemeArchive',
  'KN.SlideNodeArchive',
  'KN.SlideArchive',
  'KN.SlideStyleArchive',
  'KN.PlaceholderArchive',
  'KN.NoteArchive',
  'KN.MotionBackgroundStyleArchive',
  'KN.ClassicStylesheetRecordArchive',
  'KN.BuildArchive',
  'KN.BuildChunkArchive',
  'TSS.StylesheetArchive',
  'TSS.ThemeArchive',
  'TSD.DrawableArchive',
  'TSD.ContainerArchive',
  'TSD.GroupArchive',
  'TSD.ShapeArchive',
  'TSD.ImageArchive',
  'TSD.MovieArchive',
  'TSD.MaskArchive',
  'TSD.ConnectionLineArchive',
  'TSD.ShapeStyleArchive',
  'TSD.MediaStyleArchive',
  'TSD.ThemePresetsArchive',
  'TSD.CommentStorageArchive',
  'TSWP.StorageArchive',
  'TSWP.ShapeInfoArchive',
  'TSWP.TextualAttachmentArchive',
  'TSWP.DrawableAttachmentArchive',
  'TSWP.NumberAttachmentArchive',
  'TSWP.UnsupportedAttachmentArchive',
  'TSWP.CharacterStyleArchive',
  'TSWP.ParagraphStyleArchive',
  'TSWP.ListStyleArchive',
  'TSWP.ShapeStyleArchive',
  'TSWP.DropCapStyleArchive',
  'TSWP.CommentInfoArchive',
  'TST.TableInfoArchive',
  'TST.TableModelArchive',
  'TST.TableStyleArchive',
  'TST.CellStyleArchive',
  'TST.TableDataList',
  'TST.Tile',
  'TST.TileStorage',
  'TSCH.ChartArchive',
  'TSCH.ChartDrawableArchive',
  'TSCH.ChartStyleArchive',
];

function loadRoot() {
  const files = fs
    .readdirSync(PROTO_DIR)
    .filter((f) => f.endsWith('.proto') && !EXCLUDE_FILE.test(f));

  const googleDir = path.dirname(require.resolve('protobufjs'));
  const root = new protobuf.Root();
  root.resolvePath = (_origin, target) =>
    target.startsWith('google/protobuf/')
      ? path.join(googleDir, target)
      : path.join(PROTO_DIR, path.basename(target));

  // Imports pointing at excluded files must resolve to something; feed
  // protobuf.js an empty stub so the remaining files still parse.
  const stubs = new Set();
  const originalFetch = root.fetch.bind(root);
  root.fetch = (filename, callback) => {
    if (EXCLUDE_FILE.test(path.basename(filename))) {
      stubs.add(path.basename(filename));
      return callback(null, 'syntax = "proto2";');
    }
    return originalFetch(filename, callback);
  };

  root.loadSync(
    files.map((f) => path.join(PROTO_DIR, f)),
    { keepCase: true, alternateCommentMode: false },
  );

  // Fields whose type lived in a stubbed-out file can't resolve. Strip them
  // rather than failing: nothing in the render path reads them.
  const dropped = pruneUnresolvable(root);
  root.resolveAll();
  return { root, files, stubs: [...stubs], dropped };
}

/** Remove fields/extensions whose declared type no longer exists. */
function pruneUnresolvable(root) {
  const dropped = [];
  const visit = (ns) => {
    for (const obj of [...(ns.nestedArray ?? [])]) {
      if (obj instanceof protobuf.Type) {
        for (const field of [...obj.fieldsArray]) {
          if (!isResolvable(root, obj, field.type)) {
            obj.remove(field);
            dropped.push(`${obj.fullName}.${field.name}`);
          }
        }
        if (obj.oneofsArray) {
          for (const oneof of [...obj.oneofsArray]) {
            oneof.oneof = oneof.oneof.filter((n) => obj.fields[n]);
          }
        }
      }
      if (obj.nestedArray) visit(obj);
      if (obj.extensionsArray) {
        for (const ext of [...(obj.extensionsArray ?? [])]) {
          if (!isResolvable(root, obj, ext.type)) {
            obj.remove(ext);
            dropped.push(`ext ${ext.fullName}`);
          }
        }
      }
    }
  };
  visit(root);
  return dropped;
}

const SCALARS = new Set([
  'double', 'float', 'int32', 'uint32', 'sint32', 'fixed32', 'sfixed32',
  'int64', 'uint64', 'sint64', 'fixed64', 'sfixed64', 'bool', 'string', 'bytes',
]);

function isResolvable(root, scope, typeName) {
  if (SCALARS.has(typeName)) return true;
  try {
    return Boolean(scope.lookup(typeName) ?? root.lookup(typeName));
  } catch {
    return false;
  }
}

/** Collect the transitive closure of message/enum types reachable from roots. */
function reachable(root, registryNames) {
  const keep = new Set();
  const queue = [];

  const push = (name) => {
    if (!name || keep.has(name)) return;
    keep.add(name);
    queue.push(name);
  };

  for (const name of [...KEEP_ROOTS, ...registryNames]) {
    if (root.lookup(name)) push(name);
  }

  // Extensions attach to their extendee, so index them once up front.
  const extensionsByExtendee = new Map();
  const indexExtensions = (ns) => {
    for (const obj of ns.nestedArray ?? []) {
      if (obj instanceof protobuf.Type) {
        for (const ext of obj.fieldsArray) {
          if (!ext.extend) continue;
          const target = obj.lookup(ext.extend) ?? root.lookup(ext.extend);
          if (!target) continue;
          const list = extensionsByExtendee.get(target.fullName) ?? [];
          list.push(ext);
          extensionsByExtendee.set(target.fullName, list);
        }
      }
      if (obj.nestedArray) indexExtensions(obj);
    }
  };
  indexExtensions(root);

  while (queue.length) {
    const name = queue.pop();
    const type = root.lookup(name);
    if (!(type instanceof protobuf.Type)) continue;

    for (const field of type.fieldsArray) {
      if (SCALARS.has(field.type)) continue;
      const resolved = type.lookup(field.type) ?? root.lookup(field.type);
      if (resolved) push(resolved.fullName.replace(/^\./, ''));
    }
    // Nested declarations travel with their parent.
    for (const nested of type.nestedArray ?? []) {
      if (nested instanceof protobuf.Type || nested instanceof protobuf.Enum) {
        push(nested.fullName.replace(/^\./, ''));
      }
    }
    for (const ext of extensionsByExtendee.get(`.${name}`) ?? []) {
      if (!SCALARS.has(ext.type)) {
        const resolved = ext.parent?.lookup(ext.type) ?? root.lookup(ext.type);
        if (resolved) push(resolved.fullName.replace(/^\./, ''));
      }
      push(ext.parent.fullName.replace(/^\./, ''));
    }
  }
  return keep;
}

/** Delete every type outside `keep`, then drop namespaces left empty. */
function prune(root, keep) {
  const visit = (ns) => {
    for (const obj of [...(ns.nestedArray ?? [])]) {
      const full = obj.fullName.replace(/^\./, '');
      if (obj instanceof protobuf.Type || obj instanceof protobuf.Enum) {
        if (!keep.has(full)) {
          ns.remove(obj);
          continue;
        }
      }
      if (obj.nestedArray) visit(obj);
    }
    for (const obj of [...(ns.nestedArray ?? [])]) {
      const isNamespaceOnly =
        !(obj instanceof protobuf.Type) && !(obj instanceof protobuf.Enum);
      if (isNamespaceOnly && (obj.nestedArray ?? []).length === 0) ns.remove(obj);
    }
  };
  visit(root);
}

function main() {
  const registryRaw = JSON.parse(
    fs.readFileSync(path.join(PROTO_DIR, 'registry.json'), 'utf8'),
  );

  const { root, files, stubs, dropped } = loadRoot();

  const available = new Set();
  const indexTypes = (ns) => {
    for (const obj of ns.nestedArray ?? []) {
      if (obj instanceof protobuf.Type) available.add(obj.fullName.replace(/^\./, ''));
      if (obj.nestedArray) indexTypes(obj);
    }
  };
  indexTypes(root);

  const registry = {};
  let skipped = 0;
  for (const [id, name] of Object.entries(registryRaw)) {
    if (available.has(name)) registry[id] = name;
    else skipped++;
  }

  const keep = reachable(root, Object.values(registry));
  prune(root, keep);
  root.resolveAll();

  const schema = root.toJSON();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'schema.json'), JSON.stringify(schema));
  fs.writeFileSync(path.join(OUT_DIR, 'registry.json'), JSON.stringify(registry));
  fs.writeFileSync(
    path.join(OUT_DIR, 'meta.json'),
    JSON.stringify({ iworkVersion: VERSION, protoFiles: files.length, types: keep.size }, null, 2),
  );

  const kb = (p) => (fs.statSync(path.join(OUT_DIR, p)).size / 1024).toFixed(1);
  console.log(`iWork ${VERSION}: ${files.length} proto files (+${stubs.length} stubbed)`);
  if (dropped.length) console.log(`  dropped ${dropped.length} fields referencing excluded files`);
  console.log(`  kept ${keep.size} types, ${Object.keys(registry).length} registry entries (${skipped} outside render profile)`);
  console.log(`  schema.json ${kb('schema.json')} KB, registry.json ${kb('registry.json')} KB`);
}

main();
