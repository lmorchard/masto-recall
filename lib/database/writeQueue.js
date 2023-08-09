import BasePlugin from "../base.js";

/**
 * Implement a queue for batched writes within a transaction.
 *
 * Since SQLite's full text search index does housekeeping at the end of
 * each transaction, it's more efficient to batch up many writes rather
 * than trying to perform them one at a time.
 */
export default class DatabaseWriteQueuePlugin extends BasePlugin {
  static EVENT_BEFORE_COMMIT = Symbol("writeQueueBeforeCommit");
  static EVENT_AFTER_COMMIT_SUCCESS = Symbol("writeQueueAfterCommitSuccess");
  static EVENT_AFTER_COMMIT_ERROR = Symbol("writeQueueAfterCommitError");

  static configSchema = {
    databaseWriteBatchPeriod: {
      doc: "Minimum period to wait between committing writes in transaction batches",
      env: "DATABASE_WRITE_BATCH_PERIOD",
      format: Number,
      default: 5000,
    },
    databaseOptimizePeriod: {
      doc: "Minimum period to wait between attempting database optimization",
      env: "DATABASE_OPTIMIZE_PERIOD",
      format: Number,
      default: 1000 * 60 * 30,
    },
    databaseMaxDeferredCommitQueueSize: {
      doc: "Maximum size of the commit queue when deferring to busy database",
      env: "DATABASE_MAX_DEFERRED_COMMIT_QUEUE_SIZE",
      format: Number,
      default: 1000,
    },
  };

  constructor(parent) {
    super(parent);

    this.enableAutoCommit = true;
    this.writeBuffer = [];
    this.lastWriteTime = Date.now();
    this.lastOptimizeTime = Date.now();
    this.writeInProgress = false;
  }

  /**
   * Enqueue write for eventual execution in a transaction batch.
   *
   * @param {string} name
   * @param {object} idData
   * @param {Function} writeFn
   */
  async enqueue(name, idData = {}, writeFn, checkAutoCommit = true) {
    const log = this.log;

    log.trace({ msg: "enqueue", type: name, ...idData });
    this.writeBuffer.push(writeFn);
    if (checkAutoCommit) {
      this.maybeAutoCommit();
    }
  }

  /**
   * Commit a batch of writes in a transaction, if enough time has passed.
   * Also, attempt optimization if it's been awhile for that, too.
   */
  async maybeAutoCommit() {
    const { log } = this;
    const { config } = this.parent;

    if (!this.enableAutoCommit) {
      return;
    }

    // Wait a bit between batches, per config
    const minWritePeriod = config.get("databaseWriteBatchPeriod");
    const sinceLastWritePeriod = Date.now() - this.lastWriteTime;
    if (sinceLastWritePeriod < minWritePeriod) {
      return;
    }

    // Don't allow concurrent writes - SQLite wants a single writer
    if (this.writeInProgress) return false;
    this.writeInProgress = true;

    // Okay, here we go...
    await this.commit();

    // Clean up after ourselves and unlock for next batch
    this.lastWriteTime = Date.now();

    // See if maybe we should attempt to optimize
    const minOptimizePeriod = config.get("databaseOptimizePeriod");
    const sinceLastOptimizePeriod = this.lastWriteTime - this.lastOptimizeTime;
    if (sinceLastOptimizePeriod > minOptimizePeriod) {
      log.trace({ msg: "optimizeStart", sinceLastOptimizePeriod });
      await this.optimizeDatabase();
      this.lastOptimizeTime = Date.now();
    }

    this.writeInProgress = false;
  }

  async commit() {
    const {
      EVENT_BEFORE_COMMIT,
      EVENT_AFTER_COMMIT_SUCCESS,
      EVENT_AFTER_COMMIT_ERROR,
    } = this.constructor;
    const { config, db, events } = this.parent;
    const log = this.log;
    const sinceLastWritePeriod = Date.now() - this.lastWriteTime;

    // Emit an event before commit, in case anyone wants to enqueue anything
    await events.emit(EVENT_BEFORE_COMMIT);

    // Copy the current batch and empty out the buffer before we start
    // awaiting any database operations
    const batch = [...this.writeBuffer];
    this.writeBuffer.length = 0;

    const performStart = Date.now();
    try {
      // Perform the writes in a new transaction and measure duration
      await db.connection.transaction(async (trx) => {
        for (const writeFn of batch) {
          await writeFn(trx);
        }
      });
      log.info({
        msg: "commit",
        sinceLastWritePeriod,
        batchSize: batch.length,
        duration: Date.now() - performStart,
      });
      await events.emit(EVENT_AFTER_COMMIT_SUCCESS);
    } catch (error) {
      if ("SQLITE_BUSY" === error.code) {
        // Re-queue the batch to retry, hoping things aren't busy next time
        const maxQueueSize = config.get("databaseMaxDeferredCommitQueueSize");
        this.writeBuffer = [...this.writeBuffer, ...batch].slice(
          0 - maxQueueSize
        );
        log.warn({
          msg: "commitDeferred",
          sinceLastWritePeriod,
          batchSize: batch.length,
          duration: Date.now() - performStart,
        });
      } else {
        // TODO: we just throw away the batch at this point, maybe retry? try to recover?
        log.error({
          msg: "commitFailed",
          sinceLastWritePeriod,
          batchSize: batch.length,
          duration: Date.now() - performStart,
          error,
        });
      }
      await events.emit(EVENT_AFTER_COMMIT_ERROR, error);
    }
  }

  async optimizeDatabase() {
    const { log } = this;
    const { db } = this.parent;
    const optimizeStart = Date.now();
    try {
      log.trace({ msg: "optimizeStart" });

      await db.connection.raw("PRAGMA optimize");
      // TODO more? vacuum seems onerous

      log.info({
        msg: "optimize",
        duration: Date.now() - optimizeStart,
      });
    } catch (error) {
      log.error({
        msg: "optimizeFailed",
        duration: Date.now() - performStart,
        error,
      });
    }
  }
}
