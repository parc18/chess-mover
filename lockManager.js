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
        console.log('lock aquired' + key);
        return true; // Successfully acquired the lock
    }
     console.log('lock not aquired' + key);
    return false; // Lock was already acquired
}

/**
 * Releases a lock for a given key/resource.
 * If the lock exists, it will unlock the resource.
 */
function releaseLock(key) {
    if (locks[key]) {
        console.log('deleteing lock aquired' + key);
        delete locks[key]; // Unlock the resource
    }
}

/**
 * Waits for a lock to be released before acquiring it.
 * This function will continuously check if the lock has been released.
 */
// function waitForLock(key, interval = 100) {
//     return new Promise((resolve) => {
//         const checkLock = () => {
//             if (!locks[key]) {
//                 // If the lock is available, acquire it and resolve
//                 locks[key] = true;
//                 console.log('waited and got it..lock aquired' + key);
//                 resolve(true); // Successfully acquired the lock
//             } else {
//                 // If the lock is not available, wait and check again
//                 console.log('waiting no lock available lock Not aquired' + key);
//                 setTimeout(checkLock, interval);
//             }
//         };
//         checkLock(); // Start checking for the lock
//     });
// }

// Blocking sleep function without promises (for demonstration purposes only)
function sleep(ms) {
    const start = Date.now();
    while (Date.now() - start < ms) {
        // Busy-waiting loop to simulate sleep
    }
}

// waitForLock using a for loop and blocking sleep
function waitForLock(key, interval = 100, maxRetries = 20) {
    for (let i = 0; i < maxRetries; i++) {
        if (!locks[key]) {
            // Lock is available, acquire it
            locks[key] = true;
            console.log('Lock acquired:', key);
            return true; // Successfully acquired the lock
        } else {
            // Lock is not available, wait and retry
            console.log('Lock not available, retrying:', key);
            sleep(interval); // Blocking wait for the specified interval
        }
    }
    
    // If maxRetries reached without acquiring lock
    console.log('Failed to acquire lock after maximum retries: returning true', key);
    return true; // Failed to acquire lock
}

// Exporting the lock management functions
module.exports = {
    acquireLock,
    releaseLock,
    waitForLock
};
