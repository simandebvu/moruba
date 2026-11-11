/**
 * Development-only: send notes from the headset back to the dev server on the
 * Mac (see the `deviceReport` plugin in vite.config.ts), so a device check can
 * be read without anyone copying text off a headset. Does nothing in a build.
 */

const enabled =
  (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

interface Item {
  t: number;
  kind: string;
  data: unknown;
}

const queue: Item[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let sent: boolean | null = null;

/** null = nothing sent yet, true = last send reached the Mac, false = it failed. */
export function reportDelivered(): boolean | null {
  return enabled ? sent : null;
}

function flush(): void {
  timer = undefined;
  if (queue.length === 0) return;
  const body = JSON.stringify(queue.splice(0, queue.length));
  fetch('/__report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  })
    .then((response) => {
      sent = response.ok;
    })
    .catch(() => {
      sent = false;
    });
}

export function report(kind: string, data: unknown = {}): void {
  if (!enabled) return;
  queue.push({ t: Date.now(), kind, data });
  if (timer === undefined) timer = setTimeout(flush, 250);
}

/** What the session and its input sources look like right now. */
export function describeSession(session: XRSession | null | undefined): unknown {
  if (!session) return { session: false };
  const sources: unknown[] = [];
  for (const source of session.inputSources) {
    sources.push({
      handedness: source.handedness,
      hand: !!source.hand,
      gamepad: !!source.gamepad,
      targetRayMode: source.targetRayMode,
      profiles: [...source.profiles],
    });
  }
  return {
    session: true,
    enabledFeatures: (session as { enabledFeatures?: string[] }).enabledFeatures ?? null,
    blendMode: session.environmentBlendMode,
    frameRate: (session as { frameRate?: number }).frameRate ?? null,
    sources,
  };
}

let installed = false;

/** Forward page errors and console warnings/errors (first 60) to the Mac. */
export function installErrorReporting(): void {
  if (!enabled || installed) return;
  installed = true;
  let budget = 60;
  const text = (value: unknown): string => {
    if (value instanceof Error) return `${value.message}\n${value.stack ?? ''}`;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };
  const send = (kind: string, parts: unknown[]): void => {
    if (budget <= 0) return;
    budget -= 1;
    report(kind, parts.map(text).join(' ').slice(0, 1500));
  };
  window.addEventListener('error', (event) => {
    send('error', [event.message, event.filename, event.lineno, event.error]);
  });
  window.addEventListener('unhandledrejection', (event) => {
    send('rejection', [event.reason]);
  });
  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...parts: unknown[]) => {
      send(`console.${level}`, parts);
      original(...parts);
    };
  }
  report('page', {
    url: location.href,
    userAgent: navigator.userAgent,
    xr: 'xr' in navigator,
  });
}
