/** Editor-shaped placeholder: top bar, title, body lines and the settings panel. */
export default function EditorLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="flex min-h-dvh">
      <span className="sr-only">Opening the editor…</span>
      <div className="min-w-0 flex-1" aria-hidden="true">
        <div className="flex h-14 items-center gap-3 border-b border-line px-4">
          <div className="size-8 rounded-sm bg-surface-2" />
          <div className="h-4 w-20 animate-pulse rounded-sm bg-surface-2" />
          <div className="ml-auto h-9 w-24 animate-pulse rounded-sm bg-surface-2" />
        </div>
        <div className="mx-auto max-w-3xl px-4 pt-10 sm:px-8">
          <div className="h-10 w-2/3 animate-pulse rounded-sm bg-surface-2" />
          <div className="mt-4 h-5 w-1/2 animate-pulse rounded-sm bg-surface-2/70" />
          <div className="mt-10 space-y-4">
            {[92, 100, 84, 96, 70, 88].map((w, i) => (
              <div key={i} className="h-4 animate-pulse rounded-sm bg-surface-2/70" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      </div>
      <div className="hidden w-[22rem] border-l border-line bg-surface lg:block" aria-hidden="true">
        <div className="flex gap-1 border-b border-line px-3 py-2">
          {[64, 56, 52, 44].map((w, i) => (
            <div key={i} className="h-7 animate-pulse rounded-sm bg-surface-2" style={{ width: w }} />
          ))}
        </div>
        <div className="space-y-4 p-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-surface-2/70" />
          ))}
        </div>
      </div>
    </div>
  );
}
