export function createEngine(handlers) {
  const worker = new Worker(new URL('./llm.worker.js', import.meta.url), { type: 'module' });
  let nextId = 0;
  const pending = new Map();

  worker.addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.type === 'progress') {
      handlers.onProgress?.(message);
      return;
    }
    if (message.type === 'token') {
      handlers.onToken?.(message);
      return;
    }
    if (message.type === 'net') {
      handlers.onNet?.(message.entry);
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.type === 'error') waiter.reject(new Error(message.message || 'Model error'));
    else waiter.resolve(message);
  });

  worker.addEventListener('error', (event) => {
    const message = event.message || 'The model worker failed.';
    handlers.onWorkerError?.(message);
    for (const waiter of pending.values()) waiter.reject(new Error(message));
    pending.clear();
  });

  function call(type, payload) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ type, id, ...payload });
    });
  }

  return {
    draft(payload) {
      return call('draft', payload);
    },
    clear(payload) {
      return call('clear', payload);
    },
    interrupt() {
      worker.postMessage({ type: 'interrupt' });
    },
    setCanaries(canaries) {
      worker.postMessage({ type: 'canaries', canaries });
    },
  };
}

export async function detectWebGPU() {
  if (!navigator.gpu?.requestAdapter) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}
