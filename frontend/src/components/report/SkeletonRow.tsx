export default function SkeletonRow() {
  return (
    <div className="flex gap-4 p-4 items-center">
      <div className="w-10 h-10 rounded-lg" style={{ background: "var(--bg-muted)" }} />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-1/3 rounded" style={{ background: "var(--bg-muted)" }} />
        <div className="h-3 w-1/4 rounded" style={{ background: "var(--border)" }} />
      </div>
    </div>
  );
}
