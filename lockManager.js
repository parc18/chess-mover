// lockManager.js

// This object will store the current locks
let locks = {};

/**
 * Acquires a lock for a given key/resource.
 * If the lock is already acquired, it will return false.
 * Otherwise, it will lock the resource and return true.
 */
function acquireLock(key) {
    if (!locks[key]) {
        // Lock the resource
        locks[key] = true;
        return true; // Successfully acquired the lock
    }
    return false; // Lock was already acquired
}

/**
 * Releases a lock for a given key/resource.
 * If the lock exists, it will unlock the resource.
 */
function releaseLock(key) {
    if (locks[key]) {
        delete locks[key]; // Unlock the resource
    }
}

/**
 * Waits for a lock to be released before acquiring it.
 * This function will continuously check if the lock has been released.
 */
function waitForLock(key, interval = 100) {
    return new Promise((resolve) => {
        const checkLock = () => {
            if (!locks[key]) {
                // If the lock is available, acquire it and resolve
                locks[key] = true;
                resolve(true); // Successfully acquired the lock
            } else {
                // If the lock is not available, wait and check again
                setTimeout(checkLock, interval);
            }
        };
        checkLock(); // Start checking for the lock
    });
}

// Exporting the lock management functions
module.exports = {
    acquireLock,
    releaseLock,
    waitForLock
};
