/** Bound each provider request by both its own cap and the remaining run time. */
export async function withAiRequestDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  options: { deadline: number; maxRequestMs: number },
): Promise<T> {
  const remaining = Math.min(options.maxRequestMs, options.deadline - Date.now());
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("AI response timed out");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Cancel the transport too: a Promise.race by itself leaves a costly
      // request running after the app has already abandoned its answer.
      controller.abort();
      reject(new Error("AI response timed out"));
    }, remaining);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => run(controller.signal)), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
