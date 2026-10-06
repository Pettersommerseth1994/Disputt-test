// A pretend Cloudflare D1 database for the tests and the QA tools: the part of its API that payments/worker-shopify.js uses
// (prepare().bind().first() / .all() / .run(), and batch()), on top of an in-memory SQLite. D1 is SQLite too, so a statement that
// works here works there. Every database made here is its own, and nothing is written to disk.
import { DatabaseSync } from 'node:sqlite';

export function createFakeD1() {
  const sqlite = new DatabaseSync(':memory:');
  let failures = 0;
  let failure = 'D1 is down';
  const row = (r) => (r ? { ...r } : null); // (rows come with no prototype: a plain object compares and prints like D1's)
  const ask = (sql) => {
    if (failures > 0) {
      failures--;
      throw new Error(failure);
    }
    return sqlite.prepare(sql);
  };

  const statement = (sql, args = []) => ({
    sql,
    bind: (...values) => statement(sql, values),
    first: async () => row(ask(sql).get(...args)),
    all: async () => ({ results: ask(sql).all(...args).map(row), success: true }),
    run: async () => ({ success: true, meta: { changes: ask(sql).run(...args).changes } }),
  });

  return {
    prepare: (sql) => statement(sql),
    /** All or nothing, like D1's batch(): one statement that fails undoes the ones before it. */
    batch: async (statements) => {
      const out = [];
      sqlite.exec('BEGIN');
      try {
        for (const s of statements) out.push(await s.run());
        sqlite.exec('COMMIT');
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
      return out;
    },
    /** For tests that want to look at the data. */
    sqlite,
    /** The next `count` statements fail (a database that is down). */
    failNext(count = 1, message = 'D1 is down') {
      failures = count;
      failure = message;
    },
  };
}
