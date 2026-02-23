/**
 * Database Migration Runner
 * Executes SQL migration files in order
 */

import { Pool, PoolClient } from "pg";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

const MIGRATIONS_DIR = path.join(__dirname, "../../migrations");

/**
 * Get all migration files sorted by name
 */
function getMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
    return [];
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  return files;
}

/**
 * Check if a migration has been run
 */
async function isMigrationRun(
  pool: Pool,
  migrationName: string
): Promise<boolean> {
  try {
    const result = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE name = $1",
      [migrationName]
    );
    return result.rows.length > 0;
  } catch (err: any) {
    // If table doesn't exist, no migrations have been run
    if (err.code === "42P01") {
      return false;
    }
    throw err;
  }
}

/**
 * Mark a migration as run (accepts Pool or PoolClient; used with client inside transaction)
 */
async function markMigrationRun(
  client: Pool | PoolClient,
  migrationName: string
): Promise<void> {
  await client.query(
    "INSERT INTO schema_migrations (name, run_at) VALUES ($1, NOW())",
    [migrationName]
  );
}

/**
 * Create schema_migrations table if it doesn't exist
 */
async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Run all pending migrations
 */
export async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error(
      "DATABASE_URL not set. Skipping migrations. Set DATABASE_URL in server/.env to run migrations."
    );
    return;
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log("Connecting to database...");
    await pool.query("SELECT 1"); // Test connection
    console.log("Database connection successful.");

    // Ensure migrations table exists
    await ensureMigrationsTable(pool);
    console.log("Migrations table ready.");

    const migrationFiles = getMigrationFiles();
    console.log(`Found ${migrationFiles.length} migration file(s).`);

    if (migrationFiles.length === 0) {
      console.log("No migrations to run.");
      return;
    }

    for (const file of migrationFiles) {
      const migrationName = file;
      const filePath = path.join(MIGRATIONS_DIR, file);

      // Check if already run
      const alreadyRun = await isMigrationRun(pool, migrationName);
      if (alreadyRun) {
        console.log(`⏭️  Skipping ${migrationName} (already run)`);
        continue;
      }

      console.log(`🔄 Running migration: ${migrationName}`);

      // Read and execute migration SQL
      const sql = fs.readFileSync(filePath, "utf-8");

      // Execute migration in a transaction
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await markMigrationRun(client, migrationName);
        await client.query("COMMIT");
        console.log(`✅ Completed migration: ${migrationName}`);
      } catch (err: any) {
        await client.query("ROLLBACK");
        console.error(`❌ Failed migration: ${migrationName}`, err.message);
        throw err;
      } finally {
        client.release();
      }
    }

    console.log("✨ All migrations completed successfully!");
  } catch (err: any) {
    console.error("Migration error:", err.message);
    throw err;
  } finally {
    await pool.end();
  }
}

// Run migrations if this file is executed directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log("Migration process finished.");
      process.exit(0);
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Migration process failed:", msg);
      process.exit(1);
    });
}
