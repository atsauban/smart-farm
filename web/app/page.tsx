"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
} from "recharts";
import {
  Sun,
  Moon,
  Gauge,
  Droplets,
  Thermometer,
  Sprout,
  Power,
  Wifi,
  WifiOff,
  CloudUpload,
  Leaf,
  Activity,
  Settings,
  Boxes,
  ListChecks,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  Plus,
  Clock,
  Cloud,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { socket } from "@/lib/socket";
import type { LucideIcon } from "lucide-react";

type MetricKey = "temp" | "hum" | "soil" | "lux";

interface TelemetryPoint {
  t: number;
  temp?: number;
  hum?: number;
  soil?: number;
  lux?: number;
}

interface Thresholds {
  tempOn: number;
  humAirBelow: number;
  soilBelow: number;
  luxBelow?: number;
}

interface SensorPayload {
  serverTs?: number;
  temperature?: number;
  humidity?: number;
  soil_moisture?: number;
  light?: number;
  relay_status?: boolean;
  mode?: "auto" | "manual";
  online?: boolean;
  deviceId?: string;
}

interface LogEntry {
  t: number;
  text: string;
}

type DeviceMetaState = { pumpOn?: boolean; mode?: "auto" | "manual"; online?: boolean };

const fmtTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString();
const defaultThresholds: Thresholds = { tempOn: 32, humAirBelow: 45, soilBelow: 35, luxBelow: 40 };
const DEVICE_ID = "node-1";

const metricInfo: Record<MetricKey, {
  label: string;
  unit: string;
  icon: LucideIcon;
  accent: string;
  glow: string;
  strokeLight: string;
  strokeDark: string;
  fillLight: string;
  fillDark: string;
}> = {
  temp: {
    label: "Suhu Udara",
    unit: "\u00B0C",
    icon: Thermometer,
    accent: "from-rose-400/25 via-rose-200/10 to-transparent",
    glow: "bg-rose-500/10 border-rose-500/30",
    strokeLight: "rgba(248,113,113,0.85)",
    strokeDark: "rgba(248,113,113,0.95)",
    fillLight: "rgba(248,113,113,0.15)",
    fillDark: "rgba(248,113,113,0.22)",
  },
  hum: {
    label: "Kelembapan Udara",
    unit: "%",
    icon: Droplets,
    accent: "from-sky-400/25 via-sky-200/10 to-transparent",
    glow: "bg-sky-500/10 border-sky-500/30",
    strokeLight: "rgba(56,189,248,0.85)",
    strokeDark: "rgba(56,189,248,0.95)",
    fillLight: "rgba(56,189,248,0.18)",
    fillDark: "rgba(56,189,248,0.26)",
  },
  soil: {
    label: "Soil Moisture",
    unit: "%",
    icon: Sprout,
    accent: "from-lime-400/25 via-lime-200/10 to-transparent",
    glow: "bg-lime-500/10 border-lime-500/30",
    strokeLight: "rgba(132,204,22,0.8)",
    strokeDark: "rgba(132,204,22,0.88)",
    fillLight: "rgba(132,204,22,0.18)",
    fillDark: "rgba(132,204,22,0.26)",
  },
  lux: {
    label: "Intensitas Cahaya",
    unit: "%",
    icon: Gauge,
    accent: "from-amber-400/25 via-amber-200/10 to-transparent",
    glow: "bg-amber-500/10 border-amber-500/30",
    strokeLight: "rgba(250,204,21,0.8)",
    strokeDark: "rgba(250,204,21,0.9)",
    fillLight: "rgba(250,204,21,0.16)",
    fillDark: "rgba(250,204,21,0.24)",
  },
};

const metricOrder: MetricKey[] = ["temp", "hum", "soil", "lux"];
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const formatMetric = (value: number | null | undefined, digits = 0, suffix = "") => value == null ? "-" : `${value.toFixed(digits)}${suffix}`;

const mapPayloadToTelemetry = (payload: SensorPayload): TelemetryPoint => ({
  t: payload.serverTs ?? Date.now(),
  temp: payload.temperature,
  hum: payload.humidity,
  soil: payload.soil_moisture,
  lux: typeof payload.light === "number" ? Math.round(Math.min(100, payload.light > 100 ? payload.light / 2 : payload.light)) : undefined,
});

export default function SmartFarmDashboard() {
  const [wsConnected, setWsConnected] = useState(socket.connected);
  const [connected, setConnected] = useState(false);
  const [autoMode, setAutoMode] = useState(true);
  const [pumpOn, setPumpOn] = useState(false);
  const [thresholds, setThresholds] = useState<Thresholds>(defaultThresholds);
  const [pendingPush, setPendingPush] = useState(false);
  const [isNight, setIsNight] = useState(false);
  const [autoTheme, setAutoTheme] = useState(true);
  const [dark, setDark] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [deviceId, setDeviceId] = useState<string>(DEVICE_ID);
  const [availableDevices, setAvailableDevices] = useState<string[]>([DEVICE_ID]);
  const [historyByDevice, setHistoryByDevice] = useState<Record<string, TelemetryPoint[]>>({});
  const [deviceMeta, setDeviceMeta] = useState<Record<string, DeviceMetaState>>({});
  const [autoRecommendation, setAutoRecommendation] = useState<boolean | null>(null);

  const data = useMemo(() => historyByDevice[deviceId] ?? [], [historyByDevice, deviceId]);
  const selectedMeta = deviceMeta[deviceId];
  const deviceIdRef = useRef(deviceId);

  useEffect(() => {
    deviceIdRef.current = deviceId;
  }, [deviceId]);

  useEffect(() => {
    setLogs([]);
    setConnected(false);
  }, [deviceId]);

  useEffect(() => {
    if (!selectedMeta) return;
    if (typeof selectedMeta.pumpOn === "boolean" && selectedMeta.pumpOn !== pumpOn) {
      setPumpOn(selectedMeta.pumpOn);
    }
    if (selectedMeta.mode) {
      const desiredAuto = selectedMeta.mode !== "manual";
      setAutoMode((prevMode) => (prevMode === desiredAuto ? prevMode : desiredAuto));
    }
    if (typeof selectedMeta.online === "boolean") {
      setConnected(selectedMeta.online);
    }
  }, [selectedMeta, pumpOn]);

  useEffect(() => {
    setWsConnected(socket.connected);
    setConnected(false);

    const onConnect = () => setWsConnected(true);
    const onDisconnect = () => {
      setWsConnected(false);
      setConnected(false);
    };
    const onSnapshot = (payloads: Array<SensorPayload & { deviceId?: string; online?: boolean }> = []) => {
      const deviceMap: Record<string, TelemetryPoint[]> = {};
      const devices = new Set<string>();
      const metaUpdates: Record<string, { pumpOn?: boolean; mode?: "auto" | "manual"; online?: boolean }> = {};

      payloads.forEach((payload) => {
        const id = payload.deviceId ?? DEVICE_ID;
        devices.add(id);
        const point = mapPayloadToTelemetry(payload);
        if (!deviceMap[id]) deviceMap[id] = [];
        deviceMap[id].push(point);
        const onlineValue = typeof payload.online === "boolean" ? payload.online : true;
        const metaEntry = { ...(metaUpdates[id] ?? {}) } as DeviceMetaState;
        if (typeof payload.relay_status === "boolean") metaEntry.pumpOn = payload.relay_status;
        if (typeof payload.mode === "string") metaEntry.mode = payload.mode;
        metaEntry.online = onlineValue;
        metaUpdates[id] = metaEntry;
      });

      if (Object.keys(deviceMap).length) {
        setHistoryByDevice((prev) => {
          const next = { ...prev };
          Object.entries(deviceMap).forEach(([id, series]) => {
            next[id] = series.slice(-240);
          });
          return next;
        });
      }

      if (devices.size) {
        setAvailableDevices((prev) => {
          const merged = new Set([...prev, ...devices]);
          return Array.from(merged);
        });
        const current = deviceIdRef.current;
        if (current && !devices.has(current)) {
          const first = Array.from(devices)[0];
          if (first) setDeviceId(first);
        }
      } else {
        const current = deviceIdRef.current;
        if (!devices.has(current)) {
          setConnected(false);
        }
      }

      if (Object.keys(metaUpdates).length) {
        setDeviceMeta((prev) => {
          const next = { ...prev };
          Object.entries(metaUpdates).forEach(([id, meta]) => {
            next[id] = { ...(next[id] ?? {}), ...meta };
          });
          return next;
        });
        const current = deviceIdRef.current;
        const currentMeta = metaUpdates[current];
        if (currentMeta) {
          if (typeof currentMeta.pumpOn === "boolean") setPumpOn(currentMeta.pumpOn);
          if (currentMeta.mode) setAutoMode(currentMeta.mode !== "manual");
          if (typeof currentMeta.online === "boolean") setConnected(currentMeta.online);
        } else if (devices.has(current)) {
          setConnected(true);
        }
      } else if (devices.has(deviceIdRef.current)) {
        setConnected(true);
      }
    };

    const onData = (payload: SensorPayload & { deviceId?: string; online?: boolean }) => {
      const id = payload.deviceId ?? DEVICE_ID;
      const point = mapPayloadToTelemetry(payload);
      setHistoryByDevice((prev) => {
        const series = prev[id] ?? [];
        return { ...prev, [id]: [...series, point].slice(-240) };
      });
      setAvailableDevices((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setDeviceMeta((prev) => {
        const entry: DeviceMetaState = { ...(prev[id] ?? {}) };
        if (typeof payload.relay_status === "boolean") entry.pumpOn = payload.relay_status;
        if (typeof payload.mode === "string") entry.mode = payload.mode;
        entry.online = typeof payload.online === "boolean" ? payload.online : true;
        return { ...prev, [id]: entry };
      });
      if (id === deviceIdRef.current) {
        if (typeof payload.relay_status === "boolean") {
          setPumpOn(payload.relay_status);
        }
        if (typeof payload.mode === "string") {
          const nextAuto = payload.mode !== "manual";
          setAutoMode((prevMode) => (prevMode === nextAuto ? prevMode : nextAuto));
        }
        if (typeof payload.online === "boolean") {
          setConnected(payload.online);
        } else {
          setConnected(true);
        }
        setLogs((entries) => [
          {
            t: Date.now(),
            text: `telemetry  T=${point.temp?.toFixed?.(1) ?? "-"}C RH=${point.hum?.toFixed?.(0) ?? "-"}% soil=${point.soil?.toFixed?.(0) ?? "-"}% lux=${point.lux?.toFixed?.(0) ?? "-"}%`,
          },
          ...entries,
        ].slice(0, 40));
      }
    };

    const onDeviceStatus = ({ deviceId: id, online }: { deviceId: string; online: boolean }) => {
      setDeviceMeta((prev) => {
        const entry = { ...(prev[id] ?? {}), online };
        return { ...prev, [id]: entry };
      });
      if (id === deviceIdRef.current) {
        setConnected(online);
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("sensor:snapshot", onSnapshot);
    socket.on("sensor:data", onData);
    socket.on("device:status", onDeviceStatus);
    socket.on("connect_error", onDisconnect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("sensor:snapshot", onSnapshot);
      socket.off("sensor:data", onData);
      socket.off("device:status", onDeviceStatus);
      socket.off("connect_error", onDisconnect);
    };
  }, []);

  useEffect(() => {
    if (!data.length) {
      setIsNight(false);
      if (autoTheme) setDark(false);
      return;
    }
    const lux = data[data.length - 1].lux ?? 0;
    const night = lux <= (thresholds.luxBelow ?? 40);
    setIsNight(night);
    if (autoTheme) setDark(night);
  }, [data, thresholds.luxBelow, autoTheme]);

  useEffect(() => {
    if (!data.length) {
      setAutoRecommendation(null);
      return;
    }
    const { temp, hum, soil } = data[data.length - 1];
    const shouldPump = (temp ?? -Infinity) >= thresholds.tempOn
      || (hum ?? Infinity) <= thresholds.humAirBelow
      || (soil ?? Infinity) <= thresholds.soilBelow;
    setAutoRecommendation(shouldPump);
  }, [data, thresholds]);

  const latest = data[data.length - 1];
  const previous = data[data.length - 2];

  const metricSummary = useMemo(() => metricOrder.map((metric) => {
    const meta = metricInfo[metric];
    const latestValue = latest ? latest[metric] : undefined;
    const prevValue = previous ? previous[metric] : undefined;
    const delta = latestValue != null && prevValue != null ? latestValue - prevValue : null;
    const history = data
      .slice(-60)
      .map((point) => point[metric])
      .filter((value): value is number => typeof value === "number" && !Number.isNaN(value));
    return {
      metric,
      meta,
      latestValue,
      delta,
      history,
      direction: delta == null ? 0 : Math.sign(delta),
    };
  }), [data, latest, previous]);

  const systemSummary = useMemo(() => {
    if (!data.length) {
      return {
        avgTemp: null,
        avgHum: null,
        avgSoil: null,
        soilRisk: null,
        samples: 0,
        uptimeLabel: wsConnected ? (connected ? "Realtime aktif" : "Perangkat offline") : "Gateway terputus",
      };
    }
    const window = data.slice(-60);
    const collect = (metric: MetricKey) =>
      window
        .map((point) => point[metric])
        .filter((value): value is number => typeof value === "number" && !Number.isNaN(value));
    const soilValues = collect("soil");
    const soilBelow = soilValues.filter((value) => value <= thresholds.soilBelow).length;
    const soilRisk = soilValues.length ? Math.round((soilBelow / soilValues.length) * 100) : null;

    return {
      avgTemp: average(collect("temp")),
      avgHum: average(collect("hum")),
      avgSoil: average(soilValues),
      soilRisk,
      samples: window.length,
      uptimeLabel: wsConnected ? `${Math.min(window.length * 3, 180)} menit terakhir` : "Gateway terputus",
    };
  }, [data, thresholds.soilBelow, connected, wsConnected]);

  const executiveMetrics = useMemo(() => [
    {
      label: "Rata-rata Suhu",
      value: formatMetric(systemSummary.avgTemp, 1, "C"),
      hint: "Rentang ideal 24-30C",
    },
    {
      label: "Rata-rata Kelembapan",
      value: formatMetric(systemSummary.avgHum, 0, "%"),
      hint: "Target 45-70%",
    },
    {
      label: "Rata-rata Soil Moisture",
      value: formatMetric(systemSummary.avgSoil, 0, "%"),
      hint: `Ambang ${thresholds.soilBelow}%`,
    },
    {
      label: "Risiko Kekeringan",
      value: systemSummary.soilRisk == null ? "-" : `${systemSummary.soilRisk}%`,
      hint: systemSummary.samples ? `${systemSummary.samples} sampel • ${systemSummary.uptimeLabel}` : "Belum ada data",
    },
  ], [systemSummary, thresholds.soilBelow]);

  const sendCommand = (payload: object) =>
    new Promise<{ ok: boolean; error?: string }>((resolve) => {
      socket.emit(
        "control:send",
        { deviceId: deviceIdRef.current, ...payload },
        (response?: { ok?: boolean; error?: string }) => {
          resolve({
            ok: response?.ok ?? false,
            error: response?.error,
          });
        },
      );
    });

  const applyDeviceMode = (modeAuto: boolean) =>
    sendCommand({ cmd: "setMode", mode: modeAuto ? "auto" : "manual" });

  const handleAutoModeToggle = async (value: boolean) => {
    setAutoMode(value);
    const result = await applyDeviceMode(value);
    if (result.ok) {
      toast(`Mode ${value ? "Auto" : "Manual"} aktif`);
    } else {
      setAutoMode((prev) => !prev);
      toast(`Gagal set mode: ${result.error ?? "tidak diketahui"}`);
    }
  };

  const pushConfig = async () => {
    setPendingPush(true);
    try {
      const thresholdResult = await sendCommand({ cmd: "setThresholds", ...thresholds });
      const modeResult = await applyDeviceMode(autoMode);
      if (!thresholdResult.ok) {
        toast(`Gagal kirim thresholds: ${thresholdResult.error ?? "tidak diketahui"}`);
      } else if (!modeResult.ok) {
        toast(`Ambang batas tersimpan, tetapi mode gagal: ${modeResult.error ?? "tidak diketahui"}`);
      } else {
        toast(`${autoMode ? "Auto" : "Manual"} konfigurasi terkirim`);
      }
    } finally {
      setPendingPush(false);
    }
  };

  const togglePump = async () => {
    if (autoMode) return;
    const previous = pumpOn;
    const next = !pumpOn;
    setPumpOn(next);
    const result = await sendCommand({ cmd: "setPump", pump: next });
    if (!result.ok) {
      setPumpOn(previous);
      toast(`Gagal mengubah pompa: ${result.error ?? "tidak diketahui"}`);
    } else {
      toast(`Pompa ${next ? "ON" : "OFF"}`);
    }
  };

  const deviceOnline = connected;
  const statusLabel = wsConnected
    ? (deviceOnline ? "Perangkat online" : "Perangkat offline")
    : "Gateway terputus";

  const bgClass = dark ? "bg-neutral-950 text-white" : "bg-slate-50 text-neutral-900";
  const latestTime = latest ? fmtTime(latest.t) : "-";
  const mutedText = dark ? "text-white/70" : "text-neutral-600";
  const subtleText = dark ? "text-white/60" : "text-neutral-500";
  const headerMuted = dark ? "text-white/80" : "text-neutral-700";
  const showAutoAlert = autoMode && autoRecommendation && deviceOnline;
  const autoMismatch = autoMode && autoRecommendation && deviceOnline && !pumpOn;
  const autoAlertTitle = pumpOn ? "Auto mode menjalankan pompa" : "Ambang auto terpenuhi";
  const autoAlertDescription = pumpOn
    ? "Parameter suhu atau kelembapan mencapai ambang batas sehingga pompa otomatis menyiram."
    : "Ambang batas terpenuhi, menunggu perangkat menyalakan pompa. Periksa konektivitas jika status tidak berubah.";
  const pumpStateLabel = deviceOnline ? (pumpOn ? "Pompa aktif" : "Pompa standby") : "Perangkat offline";
  const pumpStateDescription = !deviceOnline
    ? "Perangkat belum merespons. Pastikan node ESP aktif dan koneksi stabil."
    : autoMode
      ? pumpOn
        ? "Status perangkat menunjukkan pompa sedang aktif."
        : autoRecommendation
          ? "Ambang terpenuhi namun perangkat belum menyalakan pompa."
          : "Menunggu trigger berikutnya."
      : pumpOn
        ? "Pompa dinyalakan manual."
        : "Pompa manual dalam posisi OFF.";
  const offlineBanner = !wsConnected
    ? {
        title: "Gateway realtime terputus",
        description: "Dashboard tidak terhubung ke server realtime. Periksa koneksi backend atau websocket.",
      }
    : !deviceOnline
      ? {
          title: "Perangkat tidak merespons",
          description: "Node belum mengirim telemetry terbaru. Pastikan perangkat ESP menyala dan jaringan MQTT aktif.",
        }
      : null;

  return (
    <div className={cn("relative min-h-dvh overflow-hidden transition-colors duration-500", bgClass)}>
      <Aurora isNight={isNight} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.12),transparent_60%)]" />
      <div
        className={cn(
          "pointer-events-none absolute inset-0 opacity-35",
          dark
            ? "bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)]"
            : "bg-[linear-gradient(rgba(13,148,136,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(13,148,136,0.06)_1px,transparent_1px)]",
        ) + " bg-[size:160px_160px]"
      }
      />

      <div className="relative mx-auto max-w-7xl px-4 pb-24 sm:px-6 lg:px-10">
        <header className="pt-12 space-y-12">
          <div
            className={cn(
              "rounded-3xl border px-6 py-6 backdrop-blur transition-colors",
              dark ? "border-white/20 bg-white/10 text-white" : "border-white/70 bg-white/95 shadow-xl shadow-emerald-500/10",
            )}
          >
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl space-y-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.36em] text-emerald-200">
                    SmartFarm Ops
                  </span>
                  <ModeBadge autoMode={autoMode} />
                </div>
                <div className="space-y-3">
                  <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Enterprise Operations Control</h1>
                  <p
                    className={cn(
                      "max-w-2xl text-sm leading-relaxed",
                      dark ? "text-white/80" : "text-neutral-700",
                    )}
                  >
                    Visualisasi kesehatan lingkungan dan orkestrasi automasi pompa dalam satu kanvas terpadu. Dirancang untuk tim operasional yang membutuhkan kejelasan data dan aksi cepat.
                  </p>
                </div>
                <SkyWidget isNight={isNight} latest={latest} dark={dark} />
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    size="lg"
                    className={cn(
                      "group relative overflow-hidden gap-2 transition-all duration-300",
                      dark ? "bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30" : "bg-emerald-600 text-white hover:bg-emerald-700",
                    )}
                    onClick={pushConfig}
                    disabled={pendingPush}
                  >
                    <span className="absolute inset-0 -z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-r from-emerald-500/40 via-sky-500/30 to-indigo-500/40" />
                    <CloudUpload className="h-5 w-5" />
                    {pendingPush ? "Syncing..." : "Push Konfigurasi"}
                  </Button>
                  <Link href="/rules">
                    <Button
                      size="lg"
                      variant={dark ? "secondary" : "outline"}
                      className={cn(
                        "relative gap-2 transition-all duration-300",
                        dark
                          ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100 hover:border-emerald-300 hover:bg-emerald-500/25"
                          : "hover:border-emerald-400/60 hover:text-emerald-600",
                      )}
                    >
                      <Plus className="h-5 w-5" />
                      Kelola Rules
                    </Button>
                  </Link>
                </div>
              </div>

              <div
                className={cn(
                  "w-full max-w-sm rounded-3xl border px-5 py-5 transition-colors",
                  dark ? "border-white/30 bg-neutral-900/60" : "border-neutral-200 bg-slate-50 shadow-sm",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <StatusPill online={deviceOnline} gateway={wsConnected} />
                  <DayNightBadge isNight={isNight} />
                </div>
                <div className="mt-5 space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className={cn("text-xs uppercase tracking-wide", mutedText)}>Perangkat aktif</span>
                    <span className={cn("inline-flex items-center gap-1 text-xs", subtleText)}>
                      <Clock className="h-3.5 w-3.5" />
                      {latestTime}
                    </span>
                  </div>
                  <select
                    aria-label="Device"
                    value={deviceId}
                    onChange={(event) => setDeviceId(event.target.value)}
                    disabled={pendingPush}
                    className={cn(
                      "w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/50",
                      dark ? "border-white/20 bg-white/10 text-white" : "border-neutral-200 bg-white",
                      pendingPush ? "cursor-not-allowed opacity-70" : "cursor-pointer",
                    )}
                  >
                    {availableDevices.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <div
                      className={cn(
                        "rounded-2xl border px-3 py-2 transition-colors",
                        pumpOn
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-50"
                          : dark
                            ? "border-white/20 bg-white/10 text-white/85"
                            : "border-neutral-200 bg-white text-neutral-700",
                      )}
                    >
                      <p className={cn("text-xs uppercase tracking-wide", mutedText)}>Status Pompa</p>
                      <p className="text-sm font-medium leading-tight">{pumpStateLabel}</p>
                      <p className={cn("text-[11px]", subtleText)}>{pumpStateDescription}</p>
                      {autoMismatch && (
                        <span
                          className={cn(
                            "mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                            dark
                              ? "border-amber-400/60 bg-amber-500/20 text-amber-100"
                              : "border-amber-400/70 bg-amber-100 text-amber-700",
                          )}
                        >
                          <AlertTriangle className="h-3 w-3" />
                          Menunggu perangkat
                        </span>
                      )}
                    </div>
                    <div
                      className={cn(
                        "rounded-2xl border px-3 py-2 transition-colors",
                        autoMode
                          ? dark
                            ? "border-sky-400/40 bg-sky-500/20 text-sky-100"
                            : "border-sky-500/40 bg-sky-50 text-sky-700"
                          : dark
                            ? "border-amber-400/40 bg-amber-500/20 text-amber-100"
                            : "border-amber-400/60 bg-amber-50 text-amber-700",
                      )}
                    >
                      <p className={cn("text-xs uppercase tracking-wide", mutedText)}>Mode Kendali</p>
                      <p className="text-sm font-medium leading-tight">{autoMode ? "Automasi aktif" : "Manual supervision"}</p>
                      <p className={cn("text-[11px]", subtleText)}>{systemSummary.uptimeLabel}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {executiveMetrics.map((item) => (
                <ExecutiveWidget key={item.label} label={item.label} value={item.value} hint={item.hint} dark={dark} />
              ))}
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-2">
            <NavItem href="/" icon={<Activity className="h-4 w-4" />} label="Dashboard" active />
            <NavItem href="/rules" icon={<ListChecks className="h-4 w-4" />} label="Rules" />
            <NavItem icon={<Boxes className="h-4 w-4" />} label="Devices" />
            <NavItem icon={<Settings className="h-4 w-4" />} label="Settings" />
          </nav>
        </header>

        {offlineBanner && (
          <StatusBanner
            dark={dark}
            title={offlineBanner.title}
            description={offlineBanner.description}
          />
        )}

        {showAutoAlert && (
          <StatusBanner
            dark={dark}
            title={autoAlertTitle}
            description={autoAlertDescription}
          />
        )}

        <section className="mt-12 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metricSummary.map((item, index) => (
            <MetricSummaryCard
              key={item.metric}
              metric={item.metric}
              meta={item.meta}
              latestValue={item.latestValue}
              delta={item.delta}
              history={item.history}
              direction={item.direction}
              dark={dark}
              delay={index * 0.04}
            />
          ))}
        </section>

        <section className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card
            className={cn(
              "rounded-3xl border",
              dark ? "border-white/20 bg-white/10" : "border-white/70 bg-white/90 shadow-xl shadow-emerald-500/10",
            )}
          >
            <CardHeader className="space-y-3 lg:space-y-0 lg:flex lg:flex-col lg:gap-4">
              <div className="flex flex-col gap-2">
                <CardTitle className="text-2xl font-semibold">Kontrol Pompa & Threshold</CardTitle>
                <CardDescription>Sesuaikan ambang batas untuk mode otomatis, lalu sinkronkan agar perangkat mengikutinya.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ModeBadge autoMode={autoMode} />
                <span className="rounded-full border border-emerald-400/30 px-3 py-1 text-xs font-medium uppercase tracking-wide text-emerald-200">
                  {pumpOn ? "Pompa ON" : "Pompa OFF"}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm",
                  dark ? "border-white/20 bg-white/10 text-white/90" : "border-neutral-200 bg-white",
                )}
              >
                <div>
                  <p className="font-medium">Mode otomatis</p>
                  <p className={cn("text-xs", subtleText)}>Nonaktifkan untuk mengendalikan pompa secara manual.</p>
                </div>
                <Switch
                  id="auto-mode"
                  checked={autoMode}
                  onCheckedChange={handleAutoModeToggle}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <ThresholdField dark={dark} label="Suhu = (C)" value={thresholds.tempOn} onChange={(v) => setThresholds((t) => ({ ...t, tempOn: v }))} />
                <ThresholdField dark={dark} label="RH Udara = (%)" value={thresholds.humAirBelow} onChange={(v) => setThresholds((t) => ({ ...t, humAirBelow: v }))} />
                <ThresholdField dark={dark} label="Soil = (%)" value={thresholds.soilBelow} onChange={(v) => setThresholds((t) => ({ ...t, soilBelow: v }))} />
                <ThresholdField dark={dark} label="Ambang malam (= % cahaya)" value={thresholds.luxBelow ?? 40} onChange={(v) => setThresholds((t) => ({ ...t, luxBelow: v }))} />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant={autoMode ? "secondary" : "default"}
                  disabled={autoMode}
                  onClick={togglePump}
                  className="gap-2"
                >
                  <Power className="h-4 w-4" />
                  {pumpOn ? "Matikan Pompa" : "Nyalakan Pompa"}
                </Button>
                <Button onClick={pushConfig} disabled={pendingPush} className="gap-2">
                  <CloudUpload className="h-4 w-4" />
                  {pendingPush ? "Syncing..." : "Simpan & Kirim"}
                </Button>
                <p className={cn("text-xs", subtleText)}>{autoMode ? "Manual control nonaktif saat Auto." : "Pastikan menyalakan otomatis kembali setelah uji manual."}</p>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card
              className={cn(
                "rounded-3xl border",
                dark ? "border-white/20 bg-white/10" : "border-white/70 bg-white/90 shadow-xl",
              )}
            >
              <CardHeader>
                <CardTitle>Preferensi Tampilan</CardTitle>
                <CardDescription>Sesuaikan tema agar nyaman digunakan siang dan malam.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ToggleRow
                  label="Ikuti kondisi cahaya"
                  description="Aktifkan agar tema otomatis mengikuti sensor cahaya."
                  control={<ThemeToggle checked={autoTheme} disabled={false} onCheckedChange={(value) => setAutoTheme(value)} dark={dark} variant="auto" />}
                  dark={dark}
                />
                <ToggleRow
                  label="Tema gelap"
                  description="Nonaktifkan auto untuk mengatur tema secara manual."
                  control={<ThemeToggle checked={dark} disabled={autoTheme} onCheckedChange={(value) => setDark(value)} dark={dark} variant="manual" />}
                  dark={dark}
                />
              </CardContent>
            </Card>

            <Card
              className={cn(
                "rounded-3xl border",
                dark ? "border-white/20 bg-white/10" : "border-white/70 bg-white/90 shadow-xl",
              )}
            >
              <CardHeader>
                <CardTitle>Status Real-time</CardTitle>
                <CardDescription>Pantauan cepat perangkat dan koneksi.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <QuickStat icon={Leaf} label="Perangkat" value={deviceId} tone="neutral" dark={dark} />
                <QuickStat icon={Wifi} label="Status" value={statusLabel} tone={wsConnected && deviceOnline ? "emerald" : "neutral"} dark={dark} />
                <QuickStat icon={Activity} label="Update terakhir" value={latestTime} tone="neutral" dark={dark} />
                <QuickStat icon={Power} label="Pompa" value={deviceOnline ? (pumpOn ? "ON" : "OFF") : "OFFLINE"} tone={pumpOn && deviceOnline ? "emerald" : "neutral"} dark={dark} />
                <QuickStat icon={ListChecks} label="Mode saat ini" value={autoMode ? "Auto" : "Manual"} tone="neutral" dark={dark} />
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="mt-12 grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
          <div className="grid gap-6">
            <ChartCard title="Suhu & Kelembapan Udara" dark={dark}>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                  <XAxis dataKey="t" tickFormatter={fmtTime} fontSize={12} stroke="currentColor" />
                  <YAxis yAxisId="left" domain={[0, 60]} stroke="currentColor" />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 100]} stroke="currentColor" />
                  <Tooltip labelFormatter={(value) => fmtTime(Number(value))} />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="temp" dot={false} strokeWidth={2} name="Suhu (C)" />
                  <Line yAxisId="right" type="monotone" dataKey="hum" dot={false} strokeWidth={2} name="RH Udara (%)" />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Soil Moisture & Cahaya" dark={dark}>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={data}>
                  <defs>
                    <linearGradient id="gradSoil" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="currentColor" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="currentColor" stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="gradLux" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="currentColor" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="currentColor" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                  <XAxis dataKey="t" tickFormatter={fmtTime} fontSize={12} stroke="currentColor" />
                  <YAxis domain={[0, 100]} stroke="currentColor" />
                  <Tooltip labelFormatter={(value) => fmtTime(Number(value))} />
                  <Legend />
                  <Area type="monotone" dataKey="soil" strokeWidth={2} stroke="currentColor" fill="url(#gradSoil)" name="Soil (%)" />
                  <Area type="monotone" dataKey="lux" strokeWidth={2} strokeDasharray="6 4" fill="url(#gradLux)" name="Cahaya (%)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <Card
            className={cn(
              "rounded-3xl border",
              dark ? "border-white/20 bg-white/10" : "border-white/70 bg-white/90 shadow-xl",
            )}
          >
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Realtime Log</CardTitle>
                <CardDescription>Event terbaru dari perangkat.</CardDescription>
              </div>
              <span className={cn("text-xs", subtleText)}>Node: {deviceId}</span>
            </CardHeader>
            <CardContent>
              <LogPanel logs={logs} dark={dark} />
            </CardContent>
          </Card>
        </section>

        <footer
          className={cn(
            "mt-16 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-6 py-5 text-sm backdrop-blur",
            dark ? "border-white/20 bg-white/10 text-white/85" : "border-neutral-200 bg-white/95 text-neutral-600 shadow-lg",
          )}
        >
          <span>SmartFarm  Operations Control</span>
          <span>Status: {statusLabel}</span>
        </footer>
      </div>

      <div className="fixed bottom-6 right-6 z-40 md:hidden">
        <Button size="lg" className="gap-2 shadow-lg shadow-emerald-500/25" onClick={pushConfig} disabled={pendingPush}>
          <CloudUpload className="h-5 w-5" />
          {pendingPush ? "Syncing..." : "Push Config"}
        </Button>
      </div>

      <ToastHost />
    </div>
  );
}

function MetricSummaryCard({
  metric,
  meta,
  latestValue,
  delta,
  history,
  direction,
  dark,
  delay,
}: {
  metric: MetricKey;
  meta: typeof metricInfo[MetricKey];
  latestValue?: number;
  delta: number | null;
  history: number[];
  direction: number;
  dark: boolean;
  delay: number;
}) {
  const Icon = meta.icon;
  const palette = metricInfo[metric];
  const formattedValue = latestValue == null ? "-" : latestValue.toFixed(meta.unit === "\u00B0C" ? 1 : 0);
  const deltaText = delta == null ? null : `${delta > 0 ? "+" : ""}${Math.abs(delta).toFixed(meta.unit === "\u00B0C" ? 1 : 0)}${meta.unit}`;
  const muted = dark ? "text-white/70" : "text-neutral-600";
  const subtle = dark ? "text-white/60" : "text-neutral-500";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: "spring", stiffness: 120, damping: 15 }}
      className={cn(
        "relative overflow-hidden rounded-3xl border px-5 py-5 transition-all duration-300",
        dark ? "border-white/20 bg-white/10 hover:border-white/40" : "border-white/80 bg-white/95 shadow-lg hover:border-emerald-300/50 hover:shadow-xl",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500",
          `bg-gradient-to-br ${meta.accent}`,
          "hover:opacity-100",
        )}
      />
      <div className="relative flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className={cn("text-xs uppercase tracking-wide", muted)}>{meta.label}</p>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-semibold">{formattedValue}</span>
              <span className={cn("text-sm", subtle)}>{meta.unit}</span>
            </div>
            {deltaText ? (
              <span
                className={cn(
                  "mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                  direction > 0 ? "bg-emerald-500/15 text-emerald-200" : "bg-sky-500/15 text-sky-200",
                )}
              >
                {direction > 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                {deltaText}
              </span>
            ) : (
              <span className={cn("mt-2 text-xs", subtle)}>Stabil</span>
            )}
          </div>
          <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl border", palette.glow)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <Sparkline
          points={history}
          stroke={dark ? palette.strokeDark : palette.strokeLight}
          fill={dark ? palette.fillDark : palette.fillLight}
        />
      </div>
    </motion.div>
  );
}

function SkyWidget({ isNight, latest, dark }: { isNight: boolean; latest?: TelemetryPoint; dark: boolean }) {
  const Icon = isNight ? Moon : Sun;
  const SecondaryIcon = isNight ? Sparkles : Cloud;
  const gradient = isNight
    ? "from-indigo-900/70 via-slate-900/70 to-slate-800/70 border-indigo-500/40"
    : "from-amber-100/80 via-sky-100/70 to-blue-200/70 border-amber-300/60";
  const label = isNight ? "Malam" : "Siang";
  const descriptor = isNight
    ? "Sensor cahaya rendah, automasi malam aktif."
    : "Intensitas cahaya tinggi, siklus siang aktif.";

  const temp = latest?.temp != null ? `${latest.temp.toFixed(1)}°C` : "-";
  const hum = latest?.hum != null ? `${latest.hum.toFixed(0)}% RH` : "-";
  const lux = latest?.lux != null ? `${latest.lux}% lux` : "-";
  const muted = dark ? "text-white/75" : "text-neutral-600";
  const subtle = dark ? "text-white/60" : "text-neutral-500";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative overflow-hidden rounded-3xl border px-5 py-4 transition-colors",
        gradient,
      )}
    >
      <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/20 blur-3xl opacity-40" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <motion.div
            animate={{ rotate: isNight ? [0, -6, 6, 0] : [0, 8, -8, 0] }}
            transition={{ duration: 8, repeat: Infinity }}
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg",
              isNight ? "bg-indigo-500/30 text-indigo-100" : "bg-amber-400/40 text-amber-700",
            )}
          >
            <Icon className="h-8 w-8" />
          </motion.div>
          <div>
            <p className={cn("text-xs uppercase tracking-wide", muted)}>Kondisi langit</p>
            <p className="text-lg font-semibold">{label}</p>
            <p className={cn("text-xs", subtle)}>{descriptor}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className={cn("rounded-xl border px-3 py-2", dark ? "border-white/20 bg-white/10" : "border-white/80 bg-white/70")}>
            <p className={cn("text-[11px] uppercase tracking-widest", subtle)}>Temperatur</p>
            <p className="font-medium">{temp}</p>
          </div>
          <div className={cn("rounded-xl border px-3 py-2", dark ? "border-white/20 bg-white/10" : "border-white/80 bg-white/70")}>
            <p className={cn("text-[11px] uppercase tracking-widest", subtle)}>Kelembapan</p>
            <p className="font-medium">{hum}</p>
          </div>
          <div className={cn("rounded-xl border px-3 py-2", dark ? "border-white/20 bg-white/10" : "border-white/80 bg-white/70")}>
            <p className={cn("text-[11px] uppercase tracking-widest", subtle)}>Cahaya</p>
            <p className="font-medium">{lux}</p>
          </div>
          <SecondaryIcon className={cn("h-6 w-6", isNight ? "text-indigo-200" : "text-sky-500")} />
        </div>
      </div>
    </motion.div>
  );
}

function ExecutiveWidget({ label, value, hint, dark }: { label: string; value: string; hint?: string; dark: boolean }) {
  const muted = dark ? "text-white/75" : "text-neutral-600";
  const subtle = dark ? "text-white/60" : "text-neutral-500";

  return (
    <motion.div
      whileHover={{ y: -3 }}
      className={cn(
        "flex flex-col gap-1 rounded-2xl border px-4 py-3 transition-all duration-300",
        dark ? "border-white/20 bg-white/10 text-white" : "border-neutral-200 bg-white text-neutral-800 shadow-sm",
      )}
    >
      <span className={cn("text-xs uppercase tracking-wide", muted)}>{label}</span>
      <span className="text-xl font-semibold">{value}</span>
      {hint && <span className={cn("text-xs", subtle)}>{hint}</span>}
    </motion.div>
  );
}

function ModeBadge({ autoMode }: { autoMode: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide",
        autoMode ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200" : "border-amber-400/40 bg-amber-500/15 text-amber-200",
      )}
    >
      {autoMode ? <Activity className="h-3.5 w-3.5" /> : <Settings className="h-3.5 w-3.5" />}
      {autoMode ? "Auto mode" : "Manual mode"}
    </span>
  );
}

function QuickStat({ icon: Icon, label, value, tone, dark }: { icon: LucideIcon; label: string; value: string; tone: "neutral" | "emerald"; dark: boolean }) {
  const style = tone === "emerald"
    ? dark
      ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-50"
      : "border-emerald-300 bg-emerald-50 text-emerald-700"
    : dark
      ? "border-white/20 bg-white/10 text-white/90"
      : "border-neutral-200 bg-white text-neutral-700";
  const muted = dark ? "text-white/70" : "text-neutral-500";

  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border px-3 py-2", style)}>
      <Icon className={cn("h-4 w-4", muted)} />
      <div className="flex flex-col">
        <span className={cn("text-xs uppercase tracking-wide", muted)}>{label}</span>
        <span className="text-sm font-medium">{value}</span>
      </div>
    </div>
  );
}

function ToggleRow({ label, description, control, dark }: { label: string; description: string; control: React.ReactNode; dark: boolean }) {
  const muted = dark ? "text-white/70" : "text-neutral-600";

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm",
        dark ? "border-white/20 bg-white/10 text-white/90" : "border-neutral-200 bg-white",
      )}
    >
      <div>
        <p className="font-medium">{label}</p>
        <p className={cn("text-xs", muted)}>{description}</p>
      </div>
      <div>{control}</div>
    </div>
  );
}

function ThemeToggle({ checked, disabled, onCheckedChange, dark, variant }: {
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (value: boolean) => void;
  dark: boolean;
  variant: "auto" | "manual";
}) {
  const offClass = dark ? "border-white/20 bg-white/10 text-white/80" : "border-neutral-300 bg-white text-neutral-600";
  const onAutoClass = dark ? "border-sky-400/60 bg-sky-500/20 text-sky-100" : "border-sky-500 bg-sky-50 text-sky-700";
  const onManualClass = dark ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-100" : "border-emerald-500 bg-emerald-50 text-emerald-700";
  const sliderOnClass = variant === "auto"
    ? (dark ? "bg-sky-500/50" : "bg-sky-400/70")
    : (dark ? "bg-emerald-500/50" : "bg-emerald-400/70");

  return (
    <button
      type="button"
      onClick={() => !disabled && onCheckedChange(!checked)}
      className={cn(
        "group flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide transition",
        disabled && "cursor-not-allowed opacity-60",
        variant === "auto"
          ? (checked ? onAutoClass : offClass)
          : (checked ? onManualClass : offClass),
      )}
      disabled={disabled}
    >
      <motion.span
        className={cn(
          "flex h-8 w-12 items-center justify-between rounded-full px-1 transition-colors",
          checked ? sliderOnClass : (dark ? "bg-neutral-600/60" : "bg-neutral-200"),
        )}
        layout
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
      >
        <motion.span
          className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-neutral-900 shadow"
          layout
        >
          {variant === "auto"
            ? (checked ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />)
            : (checked ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />)}
        </motion.span>
      </motion.span>
      {variant === "auto" ? (checked ? "On" : "Off") : (checked ? "Dark" : "Light")}
    </button>
  );
}

function LogPanel({ logs, dark }: { logs: LogEntry[]; dark: boolean }) {
  const muted = dark ? "text-white/70" : "text-neutral-600";
  const subtle = dark ? "text-white/60" : "text-neutral-500";
  if (!logs.length) {
    return <p className={cn("text-xs", muted)}>Belum ada data.</p>;
  }
  return (
    <div className="space-y-2 text-sm font-mono">
      {logs.slice(0, 14).map((entry) => (
        <div
          key={entry.t}
          className={cn(
            "flex items-center gap-3 rounded-xl border px-3 py-2",
            dark ? "border-white/20 bg-white/10 text-white/90" : "border-neutral-200 bg-white/80",
          )}
        >
          <span className={cn("text-xs", subtle)}>{fmtTime(entry.t)}</span>
          <span className="truncate">{entry.text}</span>
        </div>
      ))}
    </div>
  );
}

function Sparkline({ points, stroke, fill }: { points: number[]; stroke: string; fill: string }) {
  const safePoints = points.filter((value) => typeof value === "number" && !Number.isNaN(value));
  if (!safePoints.length) {
    return <div className="h-16 w-28 opacity-30" />;
  }
  const sample = safePoints.slice(-20);
  const width = 120;
  const height = 48;
  const min = Math.min(...sample);
  const max = Math.max(...sample);
  const range = max - min || 1;
  const step = sample.length > 1 ? (width - 6) / (sample.length - 1) : width;
  const path = sample
    .map((value, index) => {
      const x = 3 + index * step;
      const normalized = (value - min) / range;
      const y = height - 3 - normalized * (height - 6);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const lastX = 3 + (sample.length > 1 ? (sample.length - 1) * step : 0);
  const area = `${path} L${lastX.toFixed(2)} ${(height - 3).toFixed(2)} L3 ${(height - 3).toFixed(2)} Z`;
  return (
    <svg className="h-16 w-28" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-hidden="true">
      <path d={area} fill={fill} opacity={0.7} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusBanner({ title, description, dark }: { title: string; description: string; dark: boolean }) {
  return (
    <div
      className={cn(
        "mt-10 flex items-start gap-3 rounded-3xl border px-5 py-4 text-sm backdrop-blur transition-colors",
        dark ? "border-amber-400/40 bg-amber-500/10 text-amber-100" : "border-amber-300 bg-amber-50 text-amber-700 shadow-sm",
      )}
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 opacity-80">{description}</p>
      </div>
    </div>
  );
}

function NavItem({ href, icon, label, active = false }: { href?: string; icon: React.ReactNode; label: string; active?: boolean }) {
  const className = cn(
    "group inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-all backdrop-blur",
    active
      ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]"
      : "border-transparent text-neutral-400 hover:border-emerald-400/30 hover:bg-emerald-500/10 hover:text-emerald-300",
  );
  const content = (
    <>
      <span className="transition-transform group-hover:-translate-y-0.5">{icon}</span>
      <span>{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className={className}>{content}</Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

function StatusPill({ online, gateway }: { online: boolean; gateway: boolean }) {
  const isUp = gateway && online;
  const badgeClass = isUp
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
    : gateway
      ? "border-amber-400/40 bg-amber-500/15 text-amber-200"
      : "border-rose-500/40 bg-rose-500/15 text-rose-200";
  const dotClass = isUp ? "bg-emerald-400" : gateway ? "bg-amber-400" : "bg-rose-400";
  const label = gateway ? (online ? "Perangkat online" : "Perangkat offline") : "Gateway offline";

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
        badgeClass,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", dotClass)} />
      {isUp ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
      {label}
    </div>
  );
}

function DayNightBadge({ isNight }: { isNight: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
        isNight ? "border-indigo-400/40 bg-indigo-500/10 text-indigo-200" : "border-yellow-500/40 bg-yellow-400/10 text-yellow-700",
      )}
    >
      {isNight ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
      {isNight ? "Malam" : "Siang"}
    </div>
  );
}

function ChartCard({ title, children, dark }: { title: string; children: React.ReactNode; dark: boolean }) {
  return (
    <Card
      className={cn(
        "rounded-3xl border",
        dark ? "border-white/20 bg-white/10" : "border-white/70 bg-white/90 shadow-xl",
      )}
    >
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ThresholdField({ label, value, onChange, dark }: { label: string; value: number; onChange: (v: number) => void; dark: boolean }) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);
  const muted = dark ? "text-white/70" : "text-neutral-600";
  return (
    <div className="space-y-2">
      <Label className={cn("text-xs uppercase tracking-wide", muted)}>{label}</Label>
      <Input
        type="number"
        value={local}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setLocal(event.target.value)}
        onBlur={() => {
          const num = Number(local);
          if (Number.isFinite(num)) onChange(num);
          else setLocal(String(value));
        }}
        className="font-mono"
      />
    </div>
  );
}

function Aurora({ isNight }: { isNight: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <motion.div
        className="absolute -top-1/3 -left-1/4 h-[60vh] w-[60vw] rounded-full blur-3xl"
        style={{
          background: isNight
            ? "radial-gradient(circle at 30% 30%, rgba(99,102,241,0.25), transparent 60%)"
            : "radial-gradient(circle at 30% 30%, rgba(16,185,129,0.22), transparent 60%)",
        }}
        animate={{ x: [0, 40, -20, 0], y: [0, 20, -30, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -bottom-1/3 -right-1/4 h-[55vh] w-[55vw] rounded-full blur-3xl"
        style={{
          background: isNight
            ? "radial-gradient(circle at 70% 70%, rgba(56,189,248,0.2), transparent 60%)"
            : "radial-gradient(circle at 70% 70%, rgba(59,130,246,0.18), transparent 60%)",
        }}
        animate={{ x: [0, -30, 10, 0], y: [0, -10, 25, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

let toastListeners: Array<(msg: string) => void> = [];

function toast(message: string) {
  toastListeners.forEach((listener) => listener(message));
}

function ToastHost() {
  const [items, setItems] = useState<Array<{ id: number; msg: string }>>([]);

  useEffect(() => {
    const listener = (message: string) => {
      const id = Date.now() + Math.random();
      setItems((arr) => [...arr, { id, msg: message }]);
      setTimeout(() => setItems((arr) => arr.filter((item) => item.id !== id)), 2400);
    };
    toastListeners.push(listener);
    return () => {
      toastListeners = toastListeners.filter((fn) => fn !== listener);
    };
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {items.map((item) => (
        <motion.div
          key={item.id}
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0 }}
          className="rounded-md border border-neutral-700 bg-neutral-900/90 px-3 py-2 text-sm text-white shadow"
        >
          {item.msg}
        </motion.div>
      ))}
    </div>
  );
}













