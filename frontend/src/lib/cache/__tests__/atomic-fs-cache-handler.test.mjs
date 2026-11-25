import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import AtomicFsCacheHandler from '../atomic-fs-cache-handler.mjs';

describe('AtomicFsCacheHandler', () => {
  let tmpDir;
  let serverDistDir;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'verifa-cache-test-'));
    serverDistDir = path.join(tmpDir, '.next', 'server');
    await fsp.mkdir(path.join(serverDistDir, 'app'), { recursive: true });
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes PAGE (.html, .rsc, .meta) atomically and reads them back from disk', async () => {
    const handler = new AtomicFsCacheHandler({
      serverDistDir,
      _appDir: true,
      maxMemoryCacheSize: 0, // force disk reads
    });

    await handler.set(
      '/firma/test-sro',
      {
        kind: 'PAGE',
        html: '<html><body>Test s.r.o.</body></html>',
        pageData: '0:["$","div",null,{"children":"Test"}]',
        headers: { 'x-next-cache-tags': '_N_T_/firma/test-sro,company-123' },
        status: 200,
      },
      {}
    );

    const htmlPath = path.join(serverDistDir, 'app', 'firma', 'test-sro.html');
    const rscPath = path.join(serverDistDir, 'app', 'firma', 'test-sro.rsc');
    const metaPath = path.join(serverDistDir, 'app', 'firma', 'test-sro.meta');

    assert.equal(fs.existsSync(htmlPath), true);
    assert.equal(fs.existsSync(rscPath), true);
    assert.equal(fs.existsSync(metaPath), true);

    // No leftover .tmp files
    const entries = await fsp.readdir(path.join(serverDistDir, 'app', 'firma'));
    assert.equal(entries.some((f) => f.endsWith('.tmp')), false);

    const hit = await handler.get('/firma/test-sro', { kindHint: 'app' });
    assert.ok(hit);
    assert.equal(hit.value.kind, 'PAGE');
    assert.equal(hit.value.html, '<html><body>Test s.r.o.</body></html>');
    assert.equal(hit.value.pageData, '0:["$","div",null,{"children":"Test"}]');
    assert.equal(hit.value.status, 200);
  });

  it('prevents 0-byte .html files when simulated ENOSPC occurs mid-write', async () => {
    // Seed an existing healthy cached page first
    const healthyHandler = new AtomicFsCacheHandler({
      serverDistDir,
      _appDir: true,
      maxMemoryCacheSize: 0,
    });
    await healthyHandler.set('/firma/existing-co', {
      kind: 'PAGE',
      html: '<html>Original healthy HTML</html>',
      pageData: 'original-rsc',
      status: 200,
    });

    // Inject a failing fs wrapper that throws ENOSPC on the 2nd writeFile (simulating disk full mid-stem)
    let writeCalls = 0;
    const enospcFs = {
      ...fsp,
      async writeFile(target, content) {
        writeCalls += 1;
        if (writeCalls === 2) {
          // Simulate partial/0-byte temp file created before ENOSPC
          await fsp.writeFile(target, '');
          const err = new Error('ENOSPC: no space left on device');
          err.code = 'ENOSPC';
          throw err;
        }
        return fsp.writeFile(target, content);
      },
    };

    const failingHandler = new AtomicFsCacheHandler({
      serverDistDir,
      _appDir: true,
      maxMemoryCacheSize: 0,
      _nodeFs: enospcFs,
    });

    // 1) Overwriting an existing stem under ENOSPC must preserve the original healthy HTML intact
    await assert.rejects(
      () =>
        failingHandler.set('/firma/existing-co', {
          kind: 'PAGE',
          html: '<html>New HTML that hits ENOSPC</html>',
          pageData: 'new-rsc',
          status: 200,
        }),
      /ENOSPC/
    );

    const existingHtml = await fsp.readFile(path.join(serverDistDir, 'app', 'firma', 'existing-co.html'), 'utf8');
    assert.equal(existingHtml, '<html>Original healthy HTML</html>');

    // 2) Writing a brand-new stem under ENOSPC must leave ZERO files (no 0-byte .html, no .tmp leftovers)
    writeCalls = 0;
    await assert.rejects(
      () =>
        failingHandler.set('/firma/brand-new-co', {
          kind: 'PAGE',
          html: '<html>Brand new</html>',
          pageData: 'brand-new-rsc',
          status: 200,
        }),
      /ENOSPC/
    );

    const firmaFiles = await fsp.readdir(path.join(serverDistDir, 'app', 'firma'));
    assert.equal(firmaFiles.some((f) => f.includes('brand-new-co')), false);
    assert.equal(firmaFiles.some((f) => f.endsWith('.tmp')), false);
    assert.equal(failingHandler.getStats().atomicWriteFailures, 2);
  });

  it('rejects empty HTML on set() and treats pre-existing 0-byte .html on disk as a cache MISS', async () => {
    const handler = new AtomicFsCacheHandler({
      serverDistDir,
      _appDir: true,
      maxMemoryCacheSize: 0,
    });

    // set() refuses empty html
    await handler.set('/firma/empty-set', {
      kind: 'PAGE',
      html: '',
      pageData: 'rsc',
      status: 200,
    });
    assert.equal(fs.existsSync(path.join(serverDistDir, 'app', 'firma', 'empty-set.html')), false);

    // Pre-existing legacy 0-byte .html + non-empty .rsc on disk -> must return null (not empty HTTP 200!)
    const dir = path.join(serverDistDir, 'app', 'firma');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'corrupt-legacy.html'), '');
    await fsp.writeFile(path.join(dir, 'corrupt-legacy.rsc'), 'valid-rsc');
    await fsp.writeFile(path.join(dir, 'corrupt-legacy.meta'), JSON.stringify({ status: 200 }));

    const res = await handler.get('/firma/corrupt-legacy', { kindHint: 'app' });
    assert.equal(res, null);
    assert.equal(handler.getStats().zeroByteRejects, 2);
  });

  it('supports revalidateTag and implicit revalidatePath (_N_T_*) soft tags across handler instances', async () => {
    const handlerA = new AtomicFsCacheHandler({ serverDistDir, _appDir: true });
    const handlerB = new AtomicFsCacheHandler({ serverDistDir, _appDir: true, maxMemoryCacheSize: 0 });

    await handlerA.set('/firma/tagged-co', {
      kind: 'PAGE',
      html: '<html>v1</html>',
      pageData: 'rsc-v1',
      headers: { 'x-next-cache-tags': '_N_T_/firma/tagged-co,company-ico-12345678' },
      status: 200,
    });

    // Ensure mtime is strictly earlier than revalidateTag timestamp
    await new Promise((r) => setTimeout(r, 15));

    // Before revalidation: both handlers get a hit
    assert.ok(await handlerA.get('/firma/tagged-co', { kindHint: 'app' }));
    assert.ok(await handlerB.get('/firma/tagged-co', { kindHint: 'app' }));

    // Revalidate via implicit revalidatePath soft tag on handlerA
    await handlerA.revalidateTag('_N_T_/firma/tagged-co');

    // Both handlerA (memory) and handlerB (separate instance reading tags-manifest.json) must see MISS
    assert.equal(await handlerA.get('/firma/tagged-co', { kindHint: 'app' }), null);
    assert.equal(await handlerB.get('/firma/tagged-co', { kindHint: 'app' }), null);
  });

  it('enforces bounded disk LRU cap by evicting least-recently-used stems', async () => {
    // Cap at 250 bytes so adding 3 stems (~120 bytes each) evicts the oldest
    const handler = new AtomicFsCacheHandler({
      serverDistDir,
      _appDir: true,
      maxMemoryCacheSize: 0,
      maxDiskCacheBytes: 250,
    });

    const payload = (id) => ({
      kind: 'PAGE',
      html: `<html>${'A'.repeat(60)}-${id}</html>`,
      pageData: `rsc-${'B'.repeat(40)}-${id}`,
    });

    await handler.set('/firma/stem-1', payload('1'));
    await handler.set('/firma/stem-2', payload('2'));

    // Touch stem-1 so stem-2 becomes the LRU victim
    const hit1 = await handler.get('/firma/stem-1', { kindHint: 'app' });
    assert.ok(hit1);

    // Adding stem-3 pushes total > 250 bytes -> stem-2 should be evicted, stem-1 and stem-3 kept
    await handler.set('/firma/stem-3', payload('3'));

    assert.equal(fs.existsSync(path.join(serverDistDir, 'app', 'firma', 'stem-2.html')), false);
    assert.equal(fs.existsSync(path.join(serverDistDir, 'app', 'firma', 'stem-2.rsc')), false);
    assert.equal(fs.existsSync(path.join(serverDistDir, 'app', 'firma', 'stem-1.html')), true);
    assert.equal(fs.existsSync(path.join(serverDistDir, 'app', 'firma', 'stem-3.html')), true);
    assert.ok(handler.getStats().diskEvictions >= 1);
    assert.ok(handler.getStats().diskTotalBytes <= 250);
  });

  it('supports FETCH and ROUTE cache kinds atomically', async () => {
    const handler = new AtomicFsCacheHandler({
      serverDistDir,
      _appDir: true,
      maxMemoryCacheSize: 0,
    });

    await handler.set(
      'fetch-key-1',
      { kind: 'FETCH', data: { headers: {}, body: 'ok', status: 200 }, revalidate: 3600 },
      { tags: ['ruz-data'] }
    );
    const fetchHit = await handler.get('fetch-key-1', { kindHint: 'fetch', tags: ['ruz-data'] });
    assert.ok(fetchHit);
    assert.equal(fetchHit.value.kind, 'FETCH');

    await new Promise((r) => setTimeout(r, 15));
    await handler.revalidateTag('ruz-data');
    assert.equal(await handler.get('fetch-key-1', { kindHint: 'fetch', tags: ['ruz-data'] }), null);

    await handler.set('/api/sitemap', {
      kind: 'ROUTE',
      body: Buffer.from('<urlset></urlset>'),
      headers: { 'content-type': 'application/xml' },
      status: 200,
    });
    const routeHit = await handler.get('/api/sitemap', { kindHint: 'app' });
    assert.ok(routeHit);
    assert.equal(routeHit.value.kind, 'ROUTE');
    assert.equal(routeHit.value.body.toString(), '<urlset></urlset>');
  });
});
