const locks = {};

/**
 * Acquires a lock for a given key/resource with expiration.
 */
function acquireLock(key) {
    const now = Date.now();
    const LOCK_EXPIRY = 2000; // Expiry time in milliseconds
    if (!locks[key] || locks[key] < now) {
        locks[key] = now + LOCK_EXPIRY; // Set lock with expiration
        console.log('Lock acquired:', key);
        return true;
    }
    console.log('Lock not acquired:', key);
    return false;
}

/**
 * Releases a lock for a given key/resource.
 */
function releaseLock(key) {
    if (locks[key]) {
        console.log('Lock released:', key);
        delete locks[key];
    }
}

/**
 * Waits for a lock to be available, with retries and non-blocking sleep.
 */
async function waitForLock(key, interval = 100, maxRetries = 20) {
    for (let i = 0; i < maxRetries; i++) {
        if (acquireLock(key)) {
            return true;
        }
        console.log('Lock not available, retrying:', key);
        await new Promise((resolve) => setTimeout(resolve, interval));
    }
    console.log('Failed to acquire lock after retries:', key);
    delete locks[key];
    return false;
}

module.exports = { acquireLock, releaseLock, waitForLock };
