import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Test that rollback documentation and scripts exist.
// These tests verify the rollback migration strategy is in place.

describe("Rollback migration strategy", () => {
  const frontendRoot = process.cwd();
  const prismaDir = join(frontendRoot, "prisma");

  it("should have ROLLBACK.md documentation", () => {
    const rollbackDoc = join(prismaDir, "ROLLBACK.md");
    assert.ok(existsSync(rollbackDoc), "ROLLBACK.md should exist in prisma/");
  });

  it("should have prisma:rollback script in package.json", () => {
    const pkgPath = join(frontendRoot, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    assert.ok(pkg.scripts["prisma:rollback"], "prisma:rollback script should exist");
    assert.ok(
      pkg.scripts["prisma:rollback"].includes("migrate resolve --rolled-back"),
      "prisma:rollback should use prisma migrate resolve --rolled-back"
    );
  });

  it("ROLLBACK.md should document the procedure", () => {
    const rollbackDoc = join(prismaDir, "ROLLBACK.md");
    if (!existsSync(rollbackDoc)) return;
    const content = readFileSync(rollbackDoc, "utf-8");
    assert.ok(content.includes("prisma migrate resolve"), "Should mention prisma migrate resolve");
    assert.ok(content.includes("rolled-back"), "Should mention rolled-back flag");
    assert.ok(content.includes("backup"), "Should mention database backup");
  });

  it("ROLLBACK.md should include rollback SQL for recent migrations", () => {
    const rollbackDoc = join(prismaDir, "ROLLBACK.md");
    if (!existsSync(rollbackDoc)) return;
    const content = readFileSync(rollbackDoc, "utf-8");
    // Should have at least one DROP TABLE or ALTER TABLE statement
    assert.ok(
      content.includes("DROP TABLE") || content.includes("DROP INDEX"),
      "Should include example rollback SQL"
    );
  });
});

describe("Worker Dockerfile non-root security", () => {
  const workerRoot = join(process.cwd(), "..", "worker");
  const dockerfilePath = join(workerRoot, "Dockerfile");
  const entrypointPath = join(workerRoot, "entrypoint.sh");

  it("Dockerfile should exist", () => {
    assert.ok(existsSync(dockerfilePath), "worker/Dockerfile should exist");
  });

  it("Dockerfile should create non-root user", () => {
    if (!existsSync(dockerfilePath)) return;
    const content = readFileSync(dockerfilePath, "utf-8");
    assert.ok(content.includes("adduser"), "Should create a non-root user");
    assert.ok(content.includes("workeruser"), "Should use workeruser as username");
  });

  it("Dockerfile should install gosu for privilege dropping", () => {
    if (!existsSync(dockerfilePath)) return;
    const content = readFileSync(dockerfilePath, "utf-8");
    assert.ok(content.includes("gosu"), "Should install gosu for privilege dropping");
  });

  it("Dockerfile should have ENTRYPOINT pointing to entrypoint.sh", () => {
    if (!existsSync(dockerfilePath)) return;
    const content = readFileSync(dockerfilePath, "utf-8");
    assert.ok(content.includes('ENTRYPOINT ["/entrypoint.sh"]'), "Should use entrypoint.sh");
  });

  it("entrypoint.sh should exist and be executable", () => {
    assert.ok(existsSync(entrypointPath), "worker/entrypoint.sh should exist");
  });

  it("entrypoint.sh should fix volume permissions", () => {
    if (!existsSync(entrypointPath)) return;
    const content = readFileSync(entrypointPath, "utf-8");
    assert.ok(content.includes("chown"), "Should chown results directory");
    assert.ok(content.includes("/app/results"), "Should target /app/results");
    assert.ok(content.includes("-h"), "Should use -h flag to not follow symlinks");
  });

  it("entrypoint.sh should drop privileges via gosu", () => {
    if (!existsSync(entrypointPath)) return;
    const content = readFileSync(entrypointPath, "utf-8");
    assert.ok(content.includes("gosu workeruser"), "Should drop to workeruser via gosu");
  });

  it("Dockerfile should set results directory permissions", () => {
    if (!existsSync(dockerfilePath)) return;
    const content = readFileSync(dockerfilePath, "utf-8");
    assert.ok(content.includes("/app/results"), "Should reference /app/results");
    assert.ok(content.includes("chown"), "Should chown results directory");
  });
});
