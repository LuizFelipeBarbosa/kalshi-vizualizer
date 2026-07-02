export function Loading() {
  return <div className="py-12 text-center font-mono text-ink-2">Loading…</div>;
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return <div className="py-12 text-center font-mono text-no">{message}</div>;
}
