/**
 * AtomicFsCacheHandler — Prototype Custom Next.js 14.2.35 CacheHandler
 *
 * Addresses three failure modes identified in Next.js 14.2.35 FileSystemCache:
 *   1. Non-atomic fs.writeFile() calls that leave 0-byte .html files on ENOSPC/crash
 *      (causing Next.js to serve empty HTTP 200 responses indefinitely).
 *   2. Unbounded disk growth across dynamic ISR routes with no disk-level LRU cap.
 *   3. Stale module-level tagsManifest cache (loadTagsManifest() no-op after first read)
 *      and non-atomic tags-manifest.json writes.
 *
 * Opt-in only: NOT wired into next.config.mjs by default.
 * See docs/audits/stream3-isr-automation-cachehandler.md for rollout & opt-in config.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const NEXT_META_SUFFIX = '.meta';
const RSC_SUFFIX = '.rsc';
const RSC_PREFETCH_SUFFIX = '.prefetch.rsc';
const NEXT_DATA_SUFFIX = '.json';
const NEXT_CACHE_TAGS_HEADER = 'x-next-cache-tags';

const DEFAULT_MAX_MEMORY_BYTES = 50 * 1024 * 1024; // 50 MiB (Next.js default)
const DEFAULT_MAX_DISK_BYTES = 14 * 1024 * 1024 * 1024; // 14 GiB combined cap

/**
 * Simple O(1) byte-bounded LRU built on JS Map insertion order.
 */
class ByteLru {
  constructor(maxBytes) {
    this.maxBytes = Math.max(0, maxBytes);
    this.totalBytes = 0;
    this.map = new Map(); // key -> { value, bytes }
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    // Refresh recency
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, bytes) {
    if (this.maxBytes <= 0) return;
    const size = Math.max(1, Number(bytes) || 1);
    if (size > this.maxBytes) {
      this.delete(key);
      return;
    }
    if (this.map.has(key)) {
      this.totalBytes -= this.map.get(key).bytes;
      this.map.delete(key);
    }
    this.map.set(key, { value, bytes: size });
    this.totalBytes += size;
    while (this.totalBytes > this.maxBytes && this.map.size > 0) {
      const oldestKey = this.map.keys().next().value;
      this.delete(oldestKey);
    }
  }

  delete(key) {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.totalBytes -= entry.bytes;
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
    this.totalBytes = 0;
  }
}

function estimateValueBytes(value) {
  if (!value) return 25;
  if (value.kind === 'ROUTE') {
    return Buffer.isBuffer(value.body) ? value.body.length : Buffer.byteLength(String(value.body || ''));
  }
  if (value.kind === 'FETCH') {
    return Buffer.byteLength(JSON.stringify(value.data || ''));
  }
  if (value.kind === 'REDIRECT') {
    return Buffer.byteLength(JSON.stringify(value.props || ''));
  }
  const htmlLen = typeof value.html === 'string' ? Buffer.byteLength(value.html) : 0;
  const pageDataLen =
    typeof value.pageData === 'string'
      ? Buffer.byteLength(value.pageData)
      : Buffer.byteLength(JSON.stringify(value.pageData || ''));
  return htmlLen + pageDataLen;
}

export default class AtomicFsCacheHandler {
  constructor(ctx = {}) {
    this.fs = ctx.fs || null;
    this.nodeFs = ctx._nodeFs || fsp; // Injectable for deterministic ENOSPC tests
    this.nodeFsSync = ctx._nodeFsSync || fs;
    this.flushToDisk = ctx.flushToDisk !== false;
    this.serverDistDir = ctx.serverDistDir || path.join(process.cwd(), '.next', 'server');
    this.appDir = ctx._appDir !== undefined ? Boolean(ctx._appDir) : true;
    this.pagesDir = Boolean(ctx._pagesDir);
    this.revalidatedTags = Array.isArray(ctx.revalidatedTags) ? ctx.revalidatedTags : [];
    this.experimental = ctx.experimental || {};
    this.debug = Boolean(process.env.NEXT_PRIVATE_DEBUG_CACHE);

    const maxMem =
      typeof ctx.maxMemoryCacheSize === 'number' ? ctx.maxMemoryCacheSize : DEFAULT_MAX_MEMORY_BYTES;
    this.memoryCache = maxMem > 0 ? new ByteLru(maxMem) : null;

    const envDiskCap = Number(process.env.ISR_CACHE_MAX_DISK_BYTES);
    this.maxDiskCacheBytes =
      typeof ctx.maxDiskCacheBytes === 'number'
        ? ctx.maxDiskCacheBytes
        : Number.isFinite(envDiskCap) && envDiskCap > 0
          ? envDiskCap
          : DEFAULT_MAX_DISK_BYTES;

    this.diskEntries = new Map(); // cacheKey -> { files: string[], bytes: number, lastAccess: number }
    this.diskTotalBytes = 0;

    this.tagsManifestPath = path.join(this.serverDistDir, '..', 'cache', 'fetch-cache', 'tags-manifest.json');
    this.tagsManifest = { version: 1, items: {} };
    this.tagsManifestMtimeMs = -1;

    this.stats = {
      hitsMemory: 0,
      hitsDisk: 0,
      misses: 0,
      atomicWrites: 0,
      atomicWriteFailures: 0,
      zeroByteRejects: 0,
      diskEvictions: 0,
      diskEvictedBytes: 0,
    };

    this.loadTagsManifestSync();
  }

  resetRequestCache() {}

  getStats() {
    return {
      ...this.stats,
      diskEntries: this.diskEntries.size,
      diskTotalBytes: this.diskTotalBytes,
      maxDiskCacheBytes: this.maxDiskCacheBytes,
      memoryBytes: this.memoryCache ? this.memoryCache.totalBytes : 0,
    };
  }

  /**
   * Reload tags-manifest.json if modified on disk (fixes Next.js 14.2.35 stale manifest bug).
   */
  loadTagsManifestSync() {
    if (!this.tagsManifestPath) return;
    try {
      const st = this.nodeFsSync.statSync(this.tagsManifestPath);
      if (st.mtimeMs === this.tagsManifestMtimeMs) return;
      const raw = this.nodeFsSync.readFileSync(this.tagsManifestPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.items && typeof parsed.items === 'object') {
        this.tagsManifest = parsed;
        this.tagsManifestMtimeMs = st.mtimeMs;
      }
    } catch {
      if (this.tagsManifestMtimeMs === -1) {
        this.tagsManifest = { version: 1, items: {} };
      }
    }
  }

  async loadTagsManifestAsync() {
    if (!this.tagsManifestPath) return;
    try {
      const st = await this.nodeFs.stat(this.tagsManifestPath);
      if (st.mtimeMs === this.tagsManifestMtimeMs) return;
      const raw = await this.nodeFs.readFile(this.tagsManifestPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.items && typeof parsed.items === 'object') {
        this.tagsManifest = parsed;
        this.tagsManifestMtimeMs = st.mtimeMs;
      }
    } catch {
      if (this.tagsManifestMtimeMs === -1) {
        this.tagsManifest = { version: 1, items: {} };
      }
    }
  }

  /**
   * Write a set of files atomically via sibling temp files + rename.
   * All temp files are written completely before ANY target file is renamed,
   * so an ENOSPC or crash mid-write leaves ZERO 0-byte or mismatched targets.
   *
   * @param {Array<{ targetPath: string, content: string | Buffer }>} fileSpecs
   */
  async atomicWriteGroup(fileSpecs) {
    const staged = [];
    try {
      for (const spec of fileSpecs) {
        const dir = path.dirname(spec.targetPath);
        await this.nodeFs.mkdir(dir, { recursive: true });
        const nonce = crypto.randomBytes(6).toString('hex');
        const tmpPath = path.join(dir, `.${path.basename(spec.targetPath)}.${process.pid}.${nonce}.tmp`);
        staged.push({ tmpPath, targetPath: spec.targetPath });
        await this.nodeFs.writeFile(tmpPath, spec.content);
      }

      // All temp writes succeeded completely; now atomically rename into place.
      for (const item of staged) {
        await this.nodeFs.rename(item.tmpPath, item.targetPath);
        item.renamed = true;
      }
      this.stats.atomicWrites += staged.length;
    } catch (err) {
      this.stats.atomicWriteFailures += 1;
      // Clean up any unrenamed temp files so we never leak disk space on ENOSPC.
      for (const item of staged) {
        if (!item.renamed) {
          try {
            await this.nodeFs.unlink(item.tmpPath);
          } catch {
            // Best-effort cleanup
          }
        }
      }
      throw err;
    }
  }

  getFilePath(pathname, kind) {
    const clean = String(pathname || '').replace(/^\/+/, '');
    switch (kind) {
      case 'fetch':
        return path.join(this.serverDistDir, '..', 'cache', 'fetch-cache', clean);
      case 'pages':
        return path.join(this.serverDistDir, 'pages', clean);
      case 'app':
        return path.join(this.serverDistDir, 'app', clean);
      default:
        throw new Error(`Invariant: Can't determine file path kind: ${kind}`);
    }
  }

  detectFileKind(pathname) {
    if (!this.appDir && !this.pagesDir) {
      throw new Error("Invariant: Can't determine file path kind, no page directory enabled");
    }
    if (!this.appDir && this.pagesDir) return 'pages';
    if (this.appDir && !this.pagesDir) return 'app';
    if (this.nodeFsSync.existsSync(this.getFilePath(pathname, 'pages'))) return 'pages';
    if (this.nodeFsSync.existsSync(this.getFilePath(pathname, 'app'))) return 'app';
    throw new Error(`Invariant: Unable to determine file path kind for ${pathname}`);
  }

  _isRevalidatedByTags(tags, lastModified) {
    if (!tags || tags.length === 0) return false;
    const entryTs = lastModified || Date.now();
    return tags.some((tag) => {
      if (!tag) return false;
      if (this.revalidatedTags.includes(tag)) return true;
      const item = this.tagsManifest?.items?.[tag];
      return Boolean(item?.revalidatedAt && item.revalidatedAt >= entryTs);
    });
  }

  _recordDiskEntry(key, files, bytes) {
    if (this.diskEntries.has(key)) {
      const prev = this.diskEntries.get(key);
      this.diskTotalBytes -= prev.bytes;
      this.diskEntries.delete(key);
    }
    this.diskEntries.set(key, { files, bytes, lastAccess: Date.now() });
    this.diskTotalBytes += bytes;
  }

  _touchDiskEntry(key) {
    const rec = this.diskEntries.get(key);
    if (!rec) return;
    rec.lastAccess = Date.now();
    this.diskEntries.delete(key);
    this.diskEntries.set(key, rec);
  }

  async _enforceDiskCap(protectedKey) {
    if (this.maxDiskCacheBytes <= 0) return;
    while (this.diskTotalBytes > this.maxDiskCacheBytes && this.diskEntries.size > 0) {
      const oldestKey = this.diskEntries.keys().next().value;
      if (oldestKey === protectedKey && this.diskEntries.size === 1) {
        break;
      }
      const rec = this.diskEntries.get(oldestKey);
      this.diskEntries.delete(oldestKey);
      this.diskTotalBytes = Math.max(0, this.diskTotalBytes - rec.bytes);
      this.memoryCache?.delete(oldestKey);

      // Unlink in safe order (.html first so readers never see missing .rsc for live .html)
      const ordered = [...rec.files].sort((a, b) => {
        const rank = (p) => (p.endsWith('.html') || p.endsWith('.body') ? 0 : p.endsWith('.meta') ? 2 : 1);
        return rank(a) - rank(b);
      });
      for (const fp of ordered) {
        try {
          await this.nodeFs.unlink(fp);
        } catch {
          // Already removed
        }
      }
      this.stats.diskEvictions += 1;
      this.stats.diskEvictedBytes += rec.bytes;
    }
  }

  async revalidateTag(tags) {
    const tagList = typeof tags === 'string' ? [tags] : Array.isArray(tags) ? tags : [];
    if (tagList.length === 0) return;

    await this.loadTagsManifestAsync();
    const now = Date.now();
    for (const tag of tagList) {
      const prev = this.tagsManifest.items[tag] || {};
      this.tagsManifest.items[tag] = { ...prev, revalidatedAt: now };
    }

    try {
      await this.atomicWriteGroup([
        {
          targetPath: this.tagsManifestPath,
          content: JSON.stringify(this.tagsManifest),
        },
      ]);
      const st = await this.nodeFs.stat(this.tagsManifestPath);
      this.tagsManifestMtimeMs = st.mtimeMs;
    } catch (err) {
      console.warn('AtomicFsCacheHandler: failed to update tags manifest:', err);
    }
  }

  async get(key, ctx = {}) {
    const { tags, softTags, kindHint } = ctx;
    let data = this.memoryCache ? this.memoryCache.get(key) : undefined;
    let fromMemory = Boolean(data);

    if (!data && process.env.NEXT_RUNTIME !== 'edge') {
      // 1) Try ROUTE (.body + .meta)
      try {
        const bodyPath = this.getFilePath(`${key}.body`, 'app');
        const fileData = await this.nodeFs.readFile(bodyPath);
        const { mtime } = await this.nodeFs.stat(bodyPath);
        const meta = JSON.parse(
          await this.nodeFs.readFile(bodyPath.replace(/\.body$/, NEXT_META_SUFFIX), 'utf8')
        );
        data = {
          lastModified: mtime.getTime(),
          value: {
            kind: 'ROUTE',
            body: fileData,
            headers: meta.headers,
            status: meta.status,
          },
        };
        this._touchDiskEntry(key);
        this.stats.hitsDisk += 1;
        return data;
      } catch {
        // Not a ROUTE entry
      }

      // 2) Try FETCH or PAGE
      try {
        const kind = kindHint || this.detectFileKind(`${key}.html`);
        const isAppPath = kind === 'app';
        const filePath = this.getFilePath(kind === 'fetch' ? key : `${key}.html`, kind);
        const fileData = await this.nodeFs.readFile(filePath, 'utf8');
        const { mtime } = await this.nodeFs.stat(filePath);

        if (kind === 'fetch' && this.flushToDisk) {
          if (fileData.length === 0) {
            this.stats.zeroByteRejects += 1;
            this.stats.misses += 1;
            return null;
          }
          const parsedData = JSON.parse(fileData);
          data = { lastModified: mtime.getTime(), value: parsedData };
        } else {
          // Guard against legacy/corrupted 0-byte .html files serving empty HTTP 200
          if (fileData.length === 0) {
            this.stats.zeroByteRejects += 1;
            this.stats.misses += 1;
            return null;
          }
          const dataSuffix = isAppPath
            ? this.experimental.ppr
              ? RSC_PREFETCH_SUFFIX
              : RSC_SUFFIX
            : NEXT_DATA_SUFFIX;
          const pageDataRaw = await this.nodeFs.readFile(this.getFilePath(`${key}${dataSuffix}`, kind), 'utf8');
          const pageData = isAppPath ? pageDataRaw : JSON.parse(pageDataRaw);
          let meta;
          if (isAppPath) {
            try {
              meta = JSON.parse(
                await this.nodeFs.readFile(filePath.replace(/\.html$/, NEXT_META_SUFFIX), 'utf8')
              );
            } catch {
              // .meta is optional
            }
          }
          data = {
            lastModified: mtime.getTime(),
            value: {
              kind: 'PAGE',
              html: fileData,
              pageData,
              postponed: meta?.postponed,
              headers: meta?.headers,
              status: meta?.status,
            },
          };
        }

        if (data) {
          this._touchDiskEntry(key);
          this.memoryCache?.set(key, data, estimateValueBytes(data.value));
        }
      } catch {
        // Cache miss on disk
      }
    }

    if (!data) {
      this.stats.misses += 1;
      return null;
    }

    // Tag & soft-tag invalidation checks (covers revalidateTag + revalidatePath _N_T_* soft tags)
    if (data.value?.kind === 'PAGE') {
      const tagsHeader = data.value.headers?.[NEXT_CACHE_TAGS_HEADER];
      const headerTags = typeof tagsHeader === 'string' ? tagsHeader.split(',').filter(Boolean) : [];
      const combinedTags = [...headerTags, ...(tags || []), ...(softTags || [])];
      if (combinedTags.length > 0) {
        await this.loadTagsManifestAsync();
        if (this._isRevalidatedByTags(combinedTags, data.lastModified)) {
          this.memoryCache?.delete(key);
          this.stats.misses += 1;
          return null;
        }
      }
    } else if (data.value?.kind === 'FETCH') {
      await this.loadTagsManifestAsync();
      const storedTags = Array.isArray(data.value.tags) ? data.value.tags : [];
      const combinedTags = [...storedTags, ...(tags || []), ...(softTags || [])];
      if (this._isRevalidatedByTags(combinedTags, data.lastModified)) {
        this.memoryCache?.delete(key);
        this.stats.misses += 1;
        return null;
      }
    }

    if (fromMemory) {
      this.stats.hitsMemory += 1;
    } else {
      this.stats.hitsDisk += 1;
    }
    return data;
  }

  async set(key, data, ctx = {}) {
    if (!data) return;

    // Never cache 0-byte HTML pages in memory or on disk
    if (data.kind === 'PAGE' && (typeof data.html !== 'string' || data.html.length === 0)) {
      this.stats.zeroByteRejects += 1;
      return;
    }

    const entry = { value: data, lastModified: Date.now() };
    this.memoryCache?.set(key, entry, estimateValueBytes(data));

    if (!this.flushToDisk) return;

    const specs = [];
    if (data.kind === 'ROUTE') {
      const bodyPath = this.getFilePath(`${key}.body`, 'app');
      const metaPath = bodyPath.replace(/\.body$/, NEXT_META_SUFFIX);
      const metaContent = JSON.stringify({ headers: data.headers, status: data.status, postponed: undefined }, null, 2);
      // Rename .meta before .body so readers checking .body always find .meta
      specs.push({ targetPath: metaPath, content: metaContent });
      specs.push({ targetPath: bodyPath, content: data.body });
    } else if (data.kind === 'PAGE') {
      const isAppPath = typeof data.pageData === 'string';
      const kind = isAppPath ? 'app' : 'pages';
      const htmlPath = this.getFilePath(`${key}.html`, kind);
      const dataSuffix = isAppPath
        ? this.experimental.ppr
          ? RSC_PREFETCH_SUFFIX
          : RSC_SUFFIX
        : NEXT_DATA_SUFFIX;
      const rscPath = this.getFilePath(`${key}${dataSuffix}`, kind);
      const rscContent = isAppPath ? data.pageData : JSON.stringify(data.pageData);

      // Rename .meta and .rsc before .html so a concurrent get() reading .html never misses siblings
      if (data.headers || data.status || data.postponed) {
        const metaPath = htmlPath.replace(/\.html$/, NEXT_META_SUFFIX);
        const metaContent = JSON.stringify({
          headers: data.headers,
          status: data.status,
          postponed: data.postponed,
        });
        specs.push({ targetPath: metaPath, content: metaContent });
      }
      specs.push({ targetPath: rscPath, content: rscContent });
      specs.push({ targetPath: htmlPath, content: data.html });
    } else if (data.kind === 'FETCH') {
      const filePath = this.getFilePath(key, 'fetch');
      const payload = JSON.stringify({ ...data, tags: ctx.tags || data.tags || [] });
      specs.push({ targetPath: filePath, content: payload });
    } else {
      return;
    }

    await this.atomicWriteGroup(specs);

    const writtenBytes = specs.reduce(
      (sum, s) => sum + (Buffer.isBuffer(s.content) ? s.content.length : Buffer.byteLength(String(s.content))),
      0
    );
    this._recordDiskEntry(
      key,
      specs.map((s) => s.targetPath),
      writtenBytes
    );
    await this._enforceDiskCap(key);
  }
}
