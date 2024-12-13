class ResourceFairLock {
  constructor() {
    this.locks = new Map(); // Store locks for each resource ID
  }

  /**
   * Acquire a lock for a specific resource ID with a timeout.
   * @param {string} resourceId - The resource ID to lock.
   * @param {number} timeout - Timeout in milliseconds before giving up (default: no timeout).
   * @returns {Promise<Function>} - A function to release the lock, or rejects if timeout occurs.
   */
  acquire(resourceId, timeout = 0) {
    return new Promise((resolve, reject) => {
      if (!this.locks.has(resourceId)) {
        this.locks.set(resourceId, []);
      }

      const queue = this.locks.get(resourceId);

      const tryAcquire = () => {
        if (queue[0] === tryAcquire) {
          console.log(`Lock acquired for resource: ${resourceId}`);
          clearTimeout(timeoutHandle); // Clear timeout when lock is acquired
          resolve(() => this.release(resourceId));
        }
      };

      // Add the current request to the queue
      queue.push(tryAcquire);

      if (queue.length === 1) {
        // Lock is available, try to acquire it immediately
        tryAcquire();
      } else {
        console.log(`Resource ${resourceId} is locked. Request queued.`);
      }

      // Handle timeout if specified
      let timeoutHandle;
      if (timeout > 0) {
        timeoutHandle = setTimeout(() => {
          // Remove this request from the queue if it times out
          const index = queue.indexOf(tryAcquire);
          if (index !== -1) {
            queue.splice(index, 1);
          }

          if (queue.length === 0) {
            this.locks.delete(resourceId); // Clean up lock map if queue is empty
          }

          console.log(`Request for resource ${resourceId} timed out.`);
          reject(new Error(`Timeout: Unable to acquire lock for resource ${resourceId} within ${timeout} ms`));
        }, timeout);
      }
    });
  }

  /**
   * Release the lock for a specific resource ID.
   * @param {string} resourceId - The resource ID to release.
   */
release(resourceId) {
  const queue = this.locks.get(resourceId);
  if (!queue) {
    console.warn(`Warning: Attempted to release a lock that does not exist for resource: ${resourceId}`);
    return;
  }

  if (queue.length === 0) {
    console.warn(`Warning: Attempted to release a lock with an empty queue for resource: ${resourceId}`);
    return;
  }

  // Remove the current request from the queue
  queue.shift();

  if (queue.length > 0) {
    // Grant the lock to the next request in the queue
    console.log(`Lock granted to the next request for resource: ${resourceId}`);
    queue[0]();
  } else {
    // No more requests, remove the lock
    this.locks.delete(resourceId);
    console.log(`Lock released completely for resource: ${resourceId}`);
  }
}

}
module.exports = ResourceFairLock;
