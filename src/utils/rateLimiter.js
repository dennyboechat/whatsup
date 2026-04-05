/**
 * Simple async rate limiter: ensures minimum gap between operations.
 */
function createRateLimiter(minIntervalMs) {
  let chain = Promise.resolve();
  let lastEnd = 0;

  return async function schedule(fn) {
    const run = async () => {
      const now = Date.now();
      const wait = Math.max(0, minIntervalMs - (now - lastEnd));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await fn();
      } finally {
        lastEnd = Date.now();
      }
    };

    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  };
}

module.exports = { createRateLimiter };
