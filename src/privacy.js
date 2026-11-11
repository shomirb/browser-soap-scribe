const MODEL_HOSTS = [
  'huggingface.co',
  'hf.co',
  'xethub.hf.co',
  'jsdelivr.net',
  'githubusercontent.com',
  'github.com',
  'webllm.ai',
];

export function hostKind(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.+$/, '');
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
    return 'app';
  }
  if (MODEL_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return 'model';
  return 'unexpected';
}

export function bodyToString(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString();
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const parts = [];
    for (const [key, value] of body.entries()) {
      if (typeof value === 'string') parts.push(`${key}=${value}`);
    }
    return parts.join('&');
  }
  return '';
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function classifyRequest(urlString, bodyText, canaries) {
  let host = '';
  try {
    host = new URL(urlString, 'http://localhost').hostname;
  } catch {
    host = '';
  }
  const haystack = `${safeDecode(String(urlString || ''))}\n${bodyText || ''}`.toLowerCase();
  const hit = (canaries || []).find(
    (canary) => canary && canary.length >= 16 && haystack.includes(canary.toLowerCase()),
  );
  if (hit) {
    return {
      phase: 'blocked',
      host,
      reason: 'Blocked a request that contained transcript text.',
    };
  }
  const kind = hostKind(host);
  if (kind === 'model') {
    return { phase: 'model', host, reason: 'Model weight or runtime file. Not the transcript.' };
  }
  if (kind === 'app') {
    return { phase: 'app', host, reason: 'File from this app.' };
  }
  return { phase: 'unexpected', host, reason: 'Host is outside the model download list.' };
}

export function installNetworkGuard(root, onEvent, getCanaries) {
  if (!root || root.__soapGuard) return;
  root.__soapGuard = true;

  const report = (kind, url, decision) => {
    onEvent({
      at: Date.now(),
      kind,
      url: String(url || '').slice(0, 180),
      host: decision.host,
      phase: decision.phase,
      reason: decision.reason,
    });
  };

  const inspect = (kind, url, body) => {
    const decision = classifyRequest(url, bodyToString(body), getCanaries());
    report(kind, url, decision);
    if (decision.phase === 'blocked') {
      throw new Error(decision.reason);
    }
  };

  if (typeof root.fetch === 'function') {
    const originalFetch = root.fetch.bind(root);
    root.fetch = async function guardedFetch(input, init) {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? String(input) : input?.url || '';
      let body = init?.body;
      if (body == null && typeof Request !== 'undefined' && input instanceof Request) {
        try {
          body = await input.clone().text();
        } catch {
          body = '';
        }
      }
      inspect('fetch', url, body);
      return originalFetch(input, init);
    };
  }

  if (typeof root.XMLHttpRequest === 'function') {
    const OriginalXHR = root.XMLHttpRequest;
    class GuardedXHR extends OriginalXHR {
      open(method, url, ...rest) {
        this.__soapUrl = String(url);
        return super.open(method, url, ...rest);
      }

      send(body) {
        inspect('xhr', this.__soapUrl || '', body);
        return super.send(body);
      }
    }
    root.XMLHttpRequest = GuardedXHR;
  }

  if (typeof root.sendBeacon === 'function') {
    const originalBeacon = root.sendBeacon.bind(root);
    root.sendBeacon = (url, data) => {
      inspect('beacon', url, typeof data === 'string' ? data : '');
      return originalBeacon(url, data);
    };
  }

  if (typeof root.WebSocket === 'function') {
    const OriginalWebSocket = root.WebSocket;
    const GuardedWebSocket = function GuardedWebSocket(url, protocols) {
      inspect('websocket', url, '');
      return protocols === undefined
        ? new OriginalWebSocket(url)
        : new OriginalWebSocket(url, protocols);
    };
    GuardedWebSocket.prototype = OriginalWebSocket.prototype;
    GuardedWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
    GuardedWebSocket.OPEN = OriginalWebSocket.OPEN;
    GuardedWebSocket.CLOSING = OriginalWebSocket.CLOSING;
    GuardedWebSocket.CLOSED = OriginalWebSocket.CLOSED;
    root.WebSocket = GuardedWebSocket;
  }
}

export async function clearWeightCaches() {
  const removed = [];
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys();
    for (const key of keys) {
      if (/webllm|transformers|onnx|huggingface/i.test(key)) {
        await caches.delete(key);
        removed.push(key);
      }
    }
  }
  if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
    const databases = await indexedDB.databases();
    for (const database of databases) {
      const name = database?.name || '';
      if (/webllm|mlc|transformers/i.test(name)) {
        await new Promise((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        });
        removed.push(name);
      }
    }
  }
  return removed;
}
