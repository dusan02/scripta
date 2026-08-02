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

  const severityColor = (severity: string) => {
    switch (severity) {
      case "HIGH": return "bg-red-100 text-red-800 border-red-200";
      case "MEDIUM": return "bg-amber-100 text-amber-800 border-amber-200";
      default: return "bg-slate-100 text-slate-800 border-slate-200";
    }
  };

  const unreadCount = alerts.filter((a) => a.delivery?.status !== "READ").length;

  return (
    <div className="mt-8 space-y-6">
      {/* Watched Companies Section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
          <BellIcon className="w-5 h-5 text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900">Sledované firmy</h2>
          <span className="ml-auto text-sm text-slate-500">{watched.length} firma/firiem</span>
        </div>

        {/* Add form */}
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex gap-2">
            <input
              type="text"
              value={newIco}
              onChange={(e) => setNewIco(e.target.value)}
              placeholder="IČO (8 čísel)"
              className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={8}
            />
            <input
              type="text"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Poznámka (voliteľné)"
              className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={500}
            />
            <button
              onClick={handleAdd}
              disabled={adding}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {adding ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : <PlusIcon className="w-4 h-4" />}
              Pridať
            </button>
          </div>
        </div>

        {/* Watched list */}
        {watched.length === 0 ? (
          <div className="px-5 py-8 text-center text-slate-500 text-sm">
            Zatiaľ nesledujete žiadne firmy. Pridajte firmu zadaním IČO vyššie.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {watched.map((w) => (
              <div key={w.id} className="px-5 py-3 flex items-center gap-3">
                <Link
                  href={`/firma/${w.companyId}`}
                  className="text-sm font-medium text-blue-600 hover:underline"
                >
                  {w.companyId}
                </Link>
                {w.note && (
                  <span className="text-sm text-slate-500 truncate">— {w.note}</span>
                )}
                <button
                  onClick={() => handleRemove(w.id)}
                  disabled={removing === w.id}
                  className="ml-auto text-slate-400 hover:text-red-600 disabled:opacity-50"
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
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Najnovšie upozornenia</h2>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 rounded-full">
                {unreadCount} nové
              </span>
            )}
          </div>
          <div className="divide-y divide-slate-100">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`px-5 py-3 ${alert.delivery?.status !== "READ" ? "bg-blue-50/30" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/firma/${alert.companyId}`}
                        className="text-sm font-medium text-blue-600 hover:underline"
                      >
                        {alert.companyId}
                      </Link>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${severityColor(alert.severity)}`}>
                        {alert.severity}
                      </span>
                      <span className="text-xs text-slate-500">{alert.source}</span>
                    </div>
                    <p className="text-sm text-slate-700 mt-1">{alert.description}</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {new Date(alert.createdAt).toLocaleDateString("sk-SK")}
                    </p>
                  </div>
                  {alert.delivery?.status !== "READ" && (
                    <button
                      onClick={() => markAlertRead(alert.id)}
                      className="text-xs text-slate-500 hover:text-blue-600"
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
