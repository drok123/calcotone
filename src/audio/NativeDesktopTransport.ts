export type NativeDesktopRequestKind = 'command' | 'health' | 'spectrum';

interface NativeDesktopResponse<T = unknown> {
  type?: string;
  kind?: NativeDesktopRequestKind;
  id?: number;
  payload?: T;
}

interface WebViewPort {
  postMessage(message: string): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

interface PendingRequest {
  resolve: (payload: unknown | null) => void;
  timeout: number;
}

const RESPONSE_TYPE = 'calcotone-native-response';
const REQUEST_PREFIX = 'calcotone';
const pending = new Map<number, PendingRequest>();
let nextRequestId = 1;
let installedPort: WebViewPort | null = null;

function currentPort(): WebViewPort | null {
  const host = window as Window & { chrome?: { webview?: WebViewPort } };
  return host.chrome?.webview ?? null;
}

function onMessage(event: MessageEvent<unknown>): void {
  const message = event.data as NativeDesktopResponse | null;
  if (!message || typeof message !== 'object' || message.type !== RESPONSE_TYPE) return;
  if (!Number.isInteger(message.id)) return;
  const request = pending.get(message.id!);
  if (!request) return;
  pending.delete(message.id!);
  window.clearTimeout(request.timeout);
  request.resolve(message.payload ?? null);
}

function ensureListener(port: WebViewPort): void {
  if (installedPort === port) return;
  if (installedPort) installedPort.removeEventListener('message', onMessage);
  installedPort = port;
  installedPort.addEventListener('message', onMessage);
}

function requestLine(kind: NativeDesktopRequestKind, id: number, payload: string): string {
  return payload ? `${REQUEST_PREFIX}:${kind}:${id}:${payload}` : `${REQUEST_PREFIX}:${kind}:${id}`;
}

export function hasNativeDesktopTransport(): boolean {
  return currentPort() !== null;
}

// Zero-wait ordered post for trusted, high-rate controls. WebView2 preserves
// WebMessageReceived ordering for repeated messages from the same top-level page,
// so knob/fader traffic does not need an acknowledgement before the next value can
// enter the native control dispatcher. id=0 intentionally has no pending Promise.
export function nativeDesktopPost(kind: NativeDesktopRequestKind, payload = ''): boolean {
  const port = currentPort();
  if (!port) return false;
  ensureListener(port);
  try {
    port.postMessage(requestLine(kind, 0, payload));
    return true;
  } catch {
    return false;
  }
}

export function nativeDesktopRequest<T>(
  kind: NativeDesktopRequestKind,
  payload = '',
  timeoutMs = 750,
): Promise<T | null> | null {
  const port = currentPort();
  if (!port) return null;
  ensureListener(port);

  const id = nextRequestId++;
  if (nextRequestId >= Number.MAX_SAFE_INTEGER) nextRequestId = 1;
  const line = requestLine(kind, id, payload);

  return new Promise<T | null>((resolve) => {
    const timeout = window.setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, Math.max(50, timeoutMs));
    pending.set(id, { resolve: resolve as PendingRequest['resolve'], timeout });
    try {
      port.postMessage(line);
    } catch {
      pending.delete(id);
      window.clearTimeout(timeout);
      resolve(null);
    }
  });
}

export function resetNativeDesktopTransport(): void {
  for (const request of pending.values()) {
    window.clearTimeout(request.timeout);
    request.resolve(null);
  }
  pending.clear();
}
