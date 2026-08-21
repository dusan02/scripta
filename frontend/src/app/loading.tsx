export default function Loading() {
  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Minimal skeleton — no full-screen spinner, just subtle content placeholder */}
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Breadcrumb skeleton */}
        <div className="flex items-center gap-2 mb-4">
          <div className="h-3 w-16 rounded animate-pulse" style={{ background: "var(--bg-muted)" }} />
          <div className="h-3 w-3 rounded animate-pulse" style={{ background: "var(--bg-muted)" }} />
          <div className="h-3 w-20 rounded animate-pulse" style={{ background: "var(--bg-muted)" }} />
        </div>

        {/* Heading skeleton */}
        <div className="mb-6">
          <div className="h-7 w-48 rounded mb-2 animate-pulse" style={{ background: "var(--bg-muted)" }} />
          <div className="h-4 w-96 max-w-full rounded animate-pulse" style={{ background: "var(--bg-muted)" }} />
        </div>

        {/* Content skeleton */}
        <div className="flex flex-col lg:flex-row gap-5">
          {/* Sidebar skeleton */}
          <div className="lg:w-60 flex-shrink-0">
            <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-9 rounded-lg animate-pulse" style={{ background: "var(--bg-muted)" }} />
              ))}
            </div>
          </div>

          {/* Main content skeleton */}
          <div className="flex-1 space-y-3">
            <div className="h-5 w-32 rounded animate-pulse" style={{ background: "var(--bg-muted)" }} />
            <div className="rounded-xl space-y-2 p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-8 rounded animate-pulse" style={{ background: "var(--bg-muted)" }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
