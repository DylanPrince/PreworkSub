/** Abstraction over the job queue so services can be tested without Redis. */
export interface RunQueue {
  enqueue(runId: string, opts: { attempts: number }): Promise<void>;
  /** Removes a waiting job. Returns false if the job was already picked up. */
  remove(runId: string): Promise<boolean>;
}
