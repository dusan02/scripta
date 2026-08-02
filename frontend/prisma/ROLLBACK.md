# Database Migration Rollback Procedure

## Overview

Prisma does not support automatic SQL rollback (`down` migrations). However,
it provides `prisma migrate resolve --rolled-back` to mark a migration as
rolled back in the `_prisma_migrations` table. The actual SQL revert must be
done manually.

## Rollback Procedure

### 1. Identify the migration to roll back

```bash
npx prisma migrate status
```

List applied migrations in order:
```bash
ls frontend/prisma/migrations/
```

### 2. Mark the migration as rolled back

```bash
# Using the npm script:
npm run prisma:rollback -- 20260801800000_admin_audit_log

# Or directly:
npx prisma migrate resolve --rolled-back 20260801800000_admin_audit_log
```

### 3. Manually revert the SQL changes

Open the migration's `migration.sql` file and write the inverse SQL.
For example, if the migration created a table:

```sql
-- migration.sql (forward)
CREATE TABLE "AdminAuditLog" (...);

-- rollback.sql (manual — run manually in psql)
DROP TABLE IF EXISTS "AdminAuditLog";
```

Common inverse operations:

| Forward | Rollback |
|---------|----------|
| `CREATE TABLE` | `DROP TABLE IF EXISTS` |
| `ALTER TABLE ADD COLUMN` | `ALTER TABLE DROP COLUMN` |
| `CREATE INDEX` | `DROP INDEX IF EXISTS` |
| `ALTER TABLE ADD CONSTRAINT` | `ALTER TABLE DROP CONSTRAINT` |
| `CREATE TYPE` | `DROP TYPE IF EXISTS` |

### 4. Regenerate Prisma client

After reverting the schema:

```bash
npx prisma generate
```

### 5. Verify

```bash
npx prisma migrate status
```

## Important Notes

- **Never roll back a migration that other migrations depend on** without
  rolling back the dependent migrations first (in reverse order).
- **Always backup the database before rolling back** in production:
  ```bash
  pg_dump -U verifa -d verifa > backup_$(date +%Y%m%d).sql
  ```
- **Rollback is destructive** — data in dropped columns/tables will be lost.
- **Test rollback in staging first** before applying to production.

## Migration-Specific Rollback SQL

For convenience, here are rollback SQL statements for recent migrations:

### 20260801800000_admin_audit_log
```sql
DROP TABLE IF EXISTS "AdminAuditLog";
```

### 20260801700000_message_soft_delete
```sql
DROP INDEX IF EXISTS "UserMessage_deletedAt_idx";
ALTER TABLE "UserMessage" DROP COLUMN IF EXISTS "deletedAt";
```

### 20260801600000_add_dedup_constraints
```sql
-- See migration.sql for exact constraint names
DROP INDEX IF EXISTS "ReportRequest_userId_ico_targetType_status_idx";
DROP INDEX IF EXISTS "ReportRequest_deletedAt_idx";
-- Recreate original index if needed
```

### 20260801500000_soft_delete
```sql
DROP INDEX IF EXISTS "User_deletedAt_idx";
DROP INDEX IF EXISTS "ReportRequest_deletedAt_idx";
ALTER TABLE "User" DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "ReportRequest" DROP COLUMN IF EXISTS "deletedAt";
```
