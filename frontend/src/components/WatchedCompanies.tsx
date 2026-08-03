"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { TrashIcon, SpinnerIcon, PlusIcon, BellIcon } from "@/components/icons";

interface WatchedCompany {
  id: string;
  companyId: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AlertEvent {
  id: string;
  companyId: string;
  source: string;
  eventType: string;
  severity: string;
  title: string;
  description: string;
  createdAt: string;
  delivery: { status: string } | null;
}

export default function WatchedCompanies({ initialWatched }: { initialWatched: WatchedCompany[] }) {
  const [watched, setWatched] = useState<WatchedCompany[]>(initialWatched);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [newIco, setNewIco] = useState("");
  const [newNote, setNewNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/alert-events?limit=20");
      if (res.ok) {
        const data = await res.json();
        setAlerts(data.alerts || []);
      }
    } catch {
      // Silent fail — alerts are non-critical
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const handleAdd = useCallback(async () => {
    const ico = newIco.trim();
    if (!ico || !/^\d{8}$/.test(ico)) {
      toast.error("Zadajte platné 8-miestne IČO");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/watched-companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: ico, note: newNote.trim() || undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.restored) {
          setWatched((prev) => [data.watched, ...prev.filter((w) => w.id !== data.watched.id)]);
          toast.success("Firma bola obnovená v sledovaní");
        } else {
          setWatched((prev) => [data.watched, ...prev]);
          toast.success("Firma bola pridaná do sledovania");
        }
        setNewIco("");
        setNewNote("");
        fetchAlerts();
      } else {
        toast.error(data.error || "Chyba pri pridávaní");
      }
    } catch {
      toast.error("Chyba pri pridávaní");
    } finally {
      setAdding(false);
    }
  }, [newIco, newNote, fetchAlerts]);

  const handleRemove = useCallback(async (id: string) => {
    setRemoving(id);
    try {
      const res = await fetch(`/api/watched-companies/${id}`, { method: "DELETE" });
      if (res.ok) {
        setWatched((prev) => prev.filter((w) => w.id !== id));
        toast.success("Firma bola odstránená zo sledovania");
      } else {
        toast.error("Chyba pri odstraňovaní");
      }
    } catch {
      toast.error("Chyba pri odstraňovaní");
    } finally {
      setRemoving(null);
    }
  }, []);

  const markAlertRead = useCallback(async (alertId: string) => {
    try {
      await fetch(`/api/alert-events/${alertId}/read`, { method: "PATCH" });
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === alertId ? { ...a, delivery: { status: "READ" } } : a
        )
      );
    } catch {
      // Silent fail
    }
  }, []);

  const severityStyle = (severity: string): React.CSSProperties => {
    switch (severity) {
      case "HIGH": return { background: "var(--danger-bg)", color: "var(--danger)", borderColor: "var(--danger)" };
      case "MEDIUM": return { background: "var(--warning-bg)", color: "var(--warning-text)", borderColor: "var(--warning)" };
      default: return { background: "var(--bg-muted)", color: "var(--text-secondary)", borderColor: "var(--border)" };
    }
  };

  const unreadCount = alerts.filter((a) => a.delivery?.status !== "READ").length;

  return (
    <div className="mt-8 space-y-6">
      {/* Watched Companies Section */}
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
          <BellIcon className="w-5 h-5" style={{ color: "var(--text-secondary)" }} />
          <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>Sledované firmy</h2>
          <span className="ml-auto text-sm" style={{ color: "var(--text-muted)" }}>{watched.length} firma/firiem</span>
        </div>

        {/* Add form */}
        <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-muted)" }}>
          <div className="flex gap-2">
            <input
              type="text"
              value={newIco}
              onChange={(e) => setNewIco(e.target.value)}
              placeholder="IČO (8 čísel)"
              className="flex-1 px-3 py-2 text-sm rounded-lg focus:outline-none"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
              maxLength={8}
            />
            <input
              type="text"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Poznámka (voliteľné)"
              className="flex-1 px-3 py-2 text-sm rounded-lg focus:outline-none"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
              maxLength={500}
            />
            <button
              onClick={handleAdd}
              disabled={adding}
              className="px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 flex items-center gap-1.5"
              style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
            >
              {adding ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : <PlusIcon className="w-4 h-4" />}
              Pridať
            </button>
          </div>
        </div>

        {/* Watched list */}
        {watched.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            Zatiaľ nesledujete žiadne firmy. Pridajte firmu zadaním IČO vyššie.
          </div>
        ) : (
          <div>
            {watched.map((w, i) => (
              <div key={w.id} className="px-5 py-3 flex items-center gap-3" style={i > 0 ? { borderTop: "1px solid var(--border)" } : undefined}>
                <Link
                  href={`/firma/${w.companyId}`}
                  className="text-sm font-medium hover:underline"
                  style={{ color: "var(--accent)" }}
                >
                  {w.companyId}
                </Link>
                {w.note && (
                  <span className="text-sm truncate" style={{ color: "var(--text-muted)" }}>— {w.note}</span>
                )}
                <button
                  onClick={() => handleRemove(w.id)}
                  disabled={removing === w.id}
                  className="ml-auto disabled:opacity-50"
                  style={{ color: "var(--text-muted)" }}
                  title="Prestať sledovať"
                >
                  {removing === w.id ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : <TrashIcon className="w-4 h-4" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Alerts Section */}
      {alerts.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
            <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>Najnovšie upozornenia</h2>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 text-xs font-medium rounded-full" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>
                {unreadCount} nové
              </span>
            )}
          </div>
          <div>
            {alerts.map((alert, i) => (
              <div
                key={alert.id}
                className="px-5 py-3"
                style={{
                  borderTop: i > 0 ? "1px solid var(--border)" : undefined,
                  background: alert.delivery?.status !== "READ" ? "var(--accent-light)" : undefined,
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/firma/${alert.companyId}`}
                        className="text-sm font-medium hover:underline"
                        style={{ color: "var(--accent)" }}
                      >
                        {alert.companyId}
                      </Link>
                      <span className="text-xs px-2 py-0.5 rounded-full border" style={severityStyle(alert.severity)}>
                        {alert.severity}
                      </span>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{alert.source}</span>
                    </div>
                    <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{alert.description}</p>
                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      {new Date(alert.createdAt).toLocaleDateString("sk-SK")}
                    </p>
                  </div>
                  {alert.delivery?.status !== "READ" && (
                    <button
                      onClick={() => markAlertRead(alert.id)}
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Označiť ako prečítané
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
