"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Plus, Trash2, Save, Play, CheckCircle2, AlertTriangle, Gauge,
  Thermometer, Droplets, Sprout, Sun, Upload, Activity, ListChecks, Settings, Boxes, Wifi, WifiOff,
  ArrowUpRight, ArrowDownRight
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { socket } from "@/lib/socket";

// --- Types ---
export type Metric = "temp" | "hum" | "soil" | "lux";
export type Comparator = ">=" | "<=";
export type Action = "pump_on" | "pump_off";

export interface TelemetryPoint {
  t: number;
  temp?: number; // °C
  hum?: number;  // %
  soil?: number; // %
  lux?: number;  // % (0..100)
}

export interface Rule {
  id: string;
  enabled: boolean;
  name: string;
  metric: Metric;
  comparator: Comparator;
  value: number;        // threshold value
  forSeconds?: number;  // condition must hold for X seconds (optional)
  action: Action;
  runSeconds?: number;  // how long to pump_on/off (optional)
}

interface SensorPayload {
  serverTs?: number;
  temperature?: number;
  humidity?: number;
  soil_moisture?: number;
  light?: number;
}

// --- Helpers ---
const metricInfo: Record<Metric, { label: string; unit: string; icon: LucideIcon; accent: string; glow: string }> = {
  temp: { label: "Suhu", unit: "°C", icon: Thermometer, accent: "from-emerald-400/20 via-emerald-400/5 to-transparent", glow: "bg-emerald-500/10 border-emerald-500/30" },
  hum:  { label: "Kelembapan Udara", unit: "%", icon: Droplets, accent: "from-sky-400/20 via-sky-400/5 to-transparent", glow: "bg-sky-500/10 border-sky-500/30" },
  soil: { label: "Soil Moisture", unit: "%", icon: Sprout, accent: "from-lime-400/20 via-lime-400/5 to-transparent", glow: "bg-lime-500/10 border-lime-500/30" },
  lux:  { label: "Cahaya", unit: "%", icon: Sun, accent: "from-amber-400/20 via-amber-400/5 to-transparent", glow: "bg-amber-500/10 border-amber-500/30" },
};
const metricOrder: Metric[] = ["temp", "hum", "soil", "lux"];
const metricPalette: Record<Metric, { strokeLight: string; strokeDark: string; fillLight: string; fillDark: string }> = {
  temp: { strokeLight: "rgba(248,113,113,0.8)", strokeDark: "rgba(248,113,113,0.9)", fillLight: "rgba(248,113,113,0.15)", fillDark: "rgba(248,113,113,0.2)" },
  hum:  { strokeLight: "rgba(56,189,248,0.8)", strokeDark: "rgba(56,189,248,0.9)", fillLight: "rgba(56,189,248,0.18)", fillDark: "rgba(56,189,248,0.24)" },
  soil: { strokeLight: "rgba(132,204,22,0.75)", strokeDark: "rgba(132,204,22,0.85)", fillLight: "rgba(132,204,22,0.18)", fillDark: "rgba(132,204,22,0.26)" },
  lux:  { strokeLight: "rgba(250,204,21,0.8)", strokeDark: "rgba(250,204,21,0.88)", fillLight: "rgba(250,204,21,0.18)", fillDark: "rgba(250,204,21,0.26)" },
};
const fmtTime = (ts:number)=> new Date(ts).toLocaleTimeString();
const fmtVal = (v?: number, unit="")=> v==null? "-" : `${Number(v).toFixed(unit==="°C"?1:0)}${unit}`;

const DEFAULT_DEVICE = "node-1";

export default function RulesPage(){
  const [rules, setRules] = useState<Rule[]>([]);
  const [data, setData] = useState<TelemetryPoint[]>([]);
  const [connected, setConnected] = useState<boolean>(false);
  const [deviceId, setDeviceId] = useState<string>(DEFAULT_DEVICE);
  const [syncing, setSyncing] = useState(false);
  const [dark, setDark] = useState(true);

  // Load/sync rules from localStorage
  useEffect(()=>{
    try{
      const raw = localStorage.getItem("smartfarm_rules");
      if(raw){ setRules(JSON.parse(raw)); }
    }catch{}
  },[]);
  useEffect(()=>{
    try{ localStorage.setItem("smartfarm_rules", JSON.stringify(rules)); }catch{}
  },[rules]);

  // Live telemetry from socket
  useEffect(()=>{
    setConnected(socket.connected);
    const onConnect = ()=> setConnected(true);
    const onDisconnect = ()=> setConnected(false);
    const onData = (payload: SensorPayload)=>{
      const point: TelemetryPoint = {
        t: payload.serverTs ?? Date.now(),
        temp: payload.temperature,
        hum: payload.humidity,
        soil: payload.soil_moisture,
        lux: typeof payload.light === "number" ? Math.round(Math.min(100, payload.light > 100 ? payload.light / 2 : payload.light)) : undefined,
      };
      setData(prev=>[...prev, point].slice(-360));
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("sensor:data", onData);
    return ()=>{
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("sensor:data", onData);
    };
  },[]);

  const latest = data[data.length-1];

  const getMetricValue = (point: TelemetryPoint, metric: Metric): number | undefined =>
    point[metric as keyof TelemetryPoint] as number | undefined;

  const metricSummary = useMemo(() => {
    const store: Record<Metric, number[]> = {
      temp: [],
      hum: [],
      soil: [],
      lux: [],
    };
    const recent = data.slice(-60);
    recent.forEach((point) => {
      metricOrder.forEach((key) => {
        const raw = getMetricValue(point, key);
        if (typeof raw === "number" && !Number.isNaN(raw)) {
          store[key].push(raw);
        }
      });
    });
    return metricOrder.map((metric) => {
      const history = store[metric];
      const latestValue = history.length ? history[history.length - 1] : null;
      const prevValue = history.length > 1 ? history[history.length - 2] : null;
      const delta = latestValue != null && prevValue != null ? latestValue - prevValue : null;
      return { metric, history, latestValue, delta };
    });
  }, [data]);

  const ruleStats = useMemo(() => {
    const total = rules.length;
    const active = rules.filter((r) => r.enabled).length;
    return { total, active, inactive: total - active };
  }, [rules]);

  const { total: totalRules, active: activeRules, inactive: inactiveRules } = ruleStats;

  const heroSnapshots = useMemo(() => ([
    { label: "Rules aktif", value: activeRules, hint: `${totalRules} total` },
    { label: "Rules standby", value: inactiveRules, hint: inactiveRules === 1 ? "1 rule nonaktif" : `${inactiveRules} rules nonaktif` },
    { label: "Update terakhir", value: latest ? fmtTime(latest.t) : "-", hint: connected ? "Streaming langsung" : "Menunggu data" },
  ]), [activeRules, totalRules, inactiveRules, latest, connected]);

  const quickRulePreview = useMemo(() => rules.slice(0, 3), [rules]);

  // Evaluate a rule against recent telemetry
  const evaluateRule = (r:Rule): {ok:boolean; reason:string} => {
    if(!data.length) return { ok:false, reason:"Belum ada data" };
    const recent = data[data.length-1];
    const val = getMetricValue(recent, r.metric);
    if(val==null) return { ok:false, reason:"Nilai tidak tersedia" };

    const cmp = r.comparator === ">=" ? (val >= r.value) : (val <= r.value);
    if(r.forSeconds && r.forSeconds>0){
      const cutoff = (recent.t || Date.now()) - r.forSeconds*1000;
      const windowOk = data.filter(d=> (d.t||0) >= cutoff).every(d=>{
        const v = getMetricValue(d, r.metric);
        if(v==null) return false;
        return r.comparator === ">=" ? (v >= r.value) : (v <= r.value);
      });
      return { ok: cmp && windowOk, reason: windowOk?"Terpenuhi selama window":"Belum stabil" };
    }
    return { ok: cmp, reason: cmp?"Terpenuhi":"Belum terpenuhi" };
  };

  // Actions
  const addRule = () => {
    const n: Rule = {
      id: Math.random().toString(36).slice(2),
      enabled: true,
      name: "Rule Baru",
      metric: "soil",
      comparator: "<=",
      value: 35,
      forSeconds: 10,
      action: "pump_on",
      runSeconds: 20,
    };
    setRules(r=>[n, ...r]);
  };
  const removeRule = (id:string) => setRules(r=> r.filter(x=>x.id!==id));
  const updateRule = (id:string, patch: Partial<Rule>) => setRules(r=> r.map(x=> x.id===id ? {...x, ...patch} : x));

  const syncRules = async () => {
    setSyncing(true);
    socket.emit("rules:save", { deviceId, rules });
    toast("Rules disimpan & disync ke server");
    setTimeout(()=>setSyncing(false), 600);
  };

  const runRuleNow = (r:Rule) => {
    const res = evaluateRule(r);
    if(!res.ok){ toast("Kondisi belum terpenuhi"); return; }
    const pump = r.action === "pump_on";
    socket.emit("control:send", { deviceId, cmd:"setPump", pump });
    if(r.runSeconds && r.runSeconds>0){
      setTimeout(()=>{
        socket.emit("control:send", { deviceId, cmd:"setPump", pump: !pump });
      }, r.runSeconds*1000);
    }
    toast(`Aksi dijalankan • Pompa ${pump?"ON":"OFF"}`);
  };

  // Theme helpers
  const bgClass = dark ? "bg-neutral-950 text-white" : "bg-slate-50 text-neutral-900";
  const formatMetricValue = (metric: Metric, value: number | null) => value == null ? "-" : fmtVal(value, metricInfo[metric].unit);

  return (
    <div className={cn("relative min-h-dvh overflow-hidden transition-colors duration-500", bgClass)}>
      <Aurora />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.14),transparent_55%)]" />
      <div className={cn(
        "pointer-events-none absolute inset-0 opacity-40",
        dark ? "bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)]" :
          "bg-[linear-gradient(rgba(15,118,110,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(15,118,110,0.04)_1px,transparent_1px)]"
      ) + " bg-[size:160px_160px]"} />

      <div className="relative mx-auto max-w-7xl px-4 pb-24 sm:px-6 lg:px-10">
        <header className="space-y-8 pt-8 sm:pt-12">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <motion.div
                initial={{ rotate: -6, scale: 0.9 }}
                animate={{ rotate: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 140, damping: 14 }}
                className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-400/40 bg-emerald-500/10 text-emerald-300 shadow-[0_0_40px_rgba(16,185,129,0.25)]"
              >
                <Gauge className="h-6 w-6" />
              </motion.div>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.32em] text-emerald-300/80">SmartFarm</p>
                <h1 className="text-2xl font-semibold sm:text-3xl">Rules Orchestrator</h1>
                <p className="max-w-2xl text-sm leading-relaxed opacity-70">
                  Rancang orkestrasi automasi yang responsif untuk mengelola irigasi dan nutrisi tanaman dengan data real-time.
                </p>
              </div>
            </div>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <StatusPill connected={connected} />
              <div className={cn(
                "flex items-center gap-3 rounded-full border px-4 py-2 text-xs uppercase tracking-wide backdrop-blur",
                dark ? "border-white/15 bg-white/10 text-white/70" : "border-neutral-200 bg-white/80 text-neutral-700 shadow-sm"
              )}>
                <span>Mode</span>
                <Switch checked={dark} onCheckedChange={setDark} />
              </div>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2">
            <NavItem href="/" icon={<Activity className="h-4 w-4" />} label="Dashboard" />
            <NavItem href="/rules" icon={<ListChecks className="h-4 w-4" />} label="Rules" active />
            <NavItem icon={<Boxes className="h-4 w-4" />} label="Devices" />
            <NavItem icon={<Settings className="h-4 w-4" />} label="Settings" />
          </nav>
        </header>

        <section className={cn(
          "mt-8 rounded-3xl border px-6 py-8 transition-colors backdrop-blur-xl md:px-10 lg:py-10",
          dark ? "border-white/10 bg-white/5" : "border-white/70 bg-white/90 shadow-xl shadow-emerald-500/10"
        )}>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-6">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium uppercase tracking-widest text-emerald-200">
                Automasi Aktif
              </span>
              <h2 className="text-2xl font-semibold sm:text-3xl">
                Kendalikan siklus penyiraman cerdas dengan logika yang kamu tentukan sendiri.
              </h2>
              <p className="max-w-2xl text-sm leading-relaxed opacity-70">
                Susun kondisi, kelola aksi pompa, dan pantau performa perangkat tanpa meninggalkan dashboard ini. Setiap perubahan langsung tersinkron dengan node perangkatmu.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="lg" className="gap-2" onClick={addRule}>
                  <Plus className="h-4 w-4" />
                  Tambah Rule
                </Button>
                <Button size="lg" variant="secondary" className="gap-2" onClick={syncRules} disabled={syncing}>
                  <Upload className="h-4 w-4" />
                  {syncing ? "Syncing..." : "Sync ke Perangkat"}
                </Button>
                <Link href="/">
                  <Button size="lg" variant="outline" className="gap-2">
                    <Activity className="h-4 w-4" />
                    Kembali ke Dashboard
                  </Button>
                </Link>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm opacity-75">
                <div className="flex items-center gap-2 rounded-full border px-3 py-1">
                  <Boxes className="h-4 w-4" />
                  <span>Device:</span>
                  <select
                    aria-label="Device"
                    value={deviceId}
                    onChange={(e) => setDeviceId(e.target.value)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40",
                      dark ? "border-white/10 bg-white/5" : "border-neutral-200 bg-white"
                    )}
                  >
                    <option value="node-1">node-1</option>
                  </select>
                </div>
                <span className="rounded-full border px-3 py-1 text-xs uppercase tracking-wide">
                  {connected ? "Realtime aktif" : "Menunggu koneksi"}
                </span>
              </div>
            </div>
            <div className={cn(
              "grid gap-3 rounded-2xl border p-5 text-sm backdrop-blur",
              dark ? "border-white/10 bg-white/5" : "border-white/70 bg-white/90 shadow-lg"
            )}>
              {heroSnapshots.map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-xl border border-white/10 px-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-xs uppercase tracking-wide opacity-60">{item.label}</span>
                    <span className="text-lg font-semibold">{item.value}</span>
                  </div>
                  <span className="text-xs opacity-60">{item.hint}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-12 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm uppercase tracking-[0.28em] opacity-60">Snapshot Lingkungan</h3>
            <span className="text-xs opacity-60">Update: {latest ? fmtTime(latest.t) : "-"}</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {metricSummary.map((stat) => (
              <MetricCard
                key={stat.metric}
                metric={stat.metric}
                latest={stat.latestValue}
                delta={stat.delta}
                history={stat.history}
                dark={dark}
              />
            ))}
          </div>
        </section>

        <section className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card className={cn("relative overflow-hidden rounded-3xl border", dark ? "border-white/10 bg-white/5" : "border-white/70 bg-white/90 shadow-xl")}>
            <GradientEdge />
            <CardHeader className="gap-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-2xl font-semibold">Daftar Rules</CardTitle>
                  <CardDescription>Kelola semua automasi untuk pompa dan nutrisi tanaman.</CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-full border px-3 py-1 text-xs uppercase tracking-widest">
                    {activeRules} aktif • {totalRules} total
                  </div>
                  <Button size="sm" className="gap-2" onClick={addRule}>
                    <Plus className="h-4 w-4" />
                    Rule Baru
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {rules.length === 0 && <EmptyState onAdd={addRule} />}
                {rules.map((r, idx) => (
                  <RuleRow
                    key={r.id}
                    rule={r}
                    index={idx}
                    onChange={(patch) => updateRule(r.id, patch)}
                    onRemove={() => removeRule(r.id)}
                    evaluate={() => evaluateRule(r)}
                    onRun={() => runRuleNow(r)}
                    dark={dark}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className={cn("relative overflow-hidden rounded-3xl border", dark ? "border-white/10 bg-white/5" : "border-white/70 bg-white/90 shadow-xl")}>
              <GradientEdge />
              <CardHeader className="gap-3">
                <CardTitle>Control Center</CardTitle>
                <CardDescription>Monitor sensor dan jalankan aksi secara instan.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide opacity-70">Perangkat aktif</Label>
                  <select
                    aria-label="Device selector"
                    value={deviceId}
                    onChange={(e) => setDeviceId(e.target.value)}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40",
                      dark ? "border-white/10 bg-white/5" : "border-neutral-200 bg-white"
                    )}
                  >
                    <option value="node-1">node-1</option>
                  </select>
                </div>

                <div className="grid gap-3">
                  {metricSummary.map((stat) => (
                    <LiveTile
                      key={`live-${stat.metric}`}
                      metric={stat.metric}
                      label={metricInfo[stat.metric].label}
                      value={formatMetricValue(stat.metric, stat.latestValue)}
                      delta={stat.delta}
                      history={stat.history}
                      dark={dark}
                    />
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm" variant="secondary" className="gap-2" onClick={syncRules} disabled={syncing}>
                    <Save className="h-4 w-4" />
                    {syncing ? "Menyimpan..." : "Simpan & Sync"}
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-2" onClick={addRule}>
                    <Plus className="h-4 w-4" />
                    Rule Cepat
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className={cn("relative overflow-hidden rounded-3xl border", dark ? "border-white/10 bg-white/5" : "border-white/70 bg-white/90 shadow-xl")}>
              <GradientEdge />
              <CardHeader className="gap-3">
                <CardTitle>Ringkasan Automasi</CardTitle>
                <CardDescription>Ringkas kondisi & aksi utama dari rules teratas.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {quickRulePreview.length === 0 && (
                  <p className="text-sm opacity-70">Belum ada rule yang tersimpan. Mulai dengan menambah rule pertama.</p>
                )}
                {quickRulePreview.map((rule, idx) => (
                  <RulePeek
                    key={rule.id}
                    rule={rule}
                    index={idx}
                    evaluate={() => evaluateRule(rule)}
                    dark={dark}
                  />
                ))}
              </CardContent>
            </Card>
          </div>
        </section>

        <footer className={cn(
          "mt-16 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-6 py-5 text-sm backdrop-blur",
          dark ? "border-white/10 bg-white/5 text-white/70" : "border-neutral-200 bg-white/90 text-neutral-600 shadow-lg"
        )}>
          <span>SmartFarm • Rules Engine</span>
          <span>Status: {connected ? "Realtime aktif" : "Terputus"}</span>
        </footer>
      </div>

      <div className="fixed bottom-6 left-6 z-40 md:hidden">
        <Button size="lg" className="gap-2 shadow-lg shadow-emerald-500/20" onClick={addRule}>
          <Plus className="h-5 w-5" />
          Rule Baru
        </Button>
      </div>

      <ToastHost />
    </div>
  );
}

// --- Components ---
function MetricCard({ metric, latest, delta, history, dark }: {
  metric: Metric;
  latest: number | null;
  delta: number | null;
  history: number[];
  dark: boolean;
}) {
  const meta = metricInfo[metric];
  const palette = metricPalette[metric];
  const Icon = meta.icon;
  const stroke = dark ? palette.strokeDark : palette.strokeLight;
  const fill = dark ? palette.fillDark : palette.fillLight;
  const showDelta = delta != null && Math.abs(delta) > 0.01;
  const displayValue = latest == null ? "-" : Number(latest).toFixed(meta.unit === "°C" ? 1 : 0);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      className={cn(
        "group relative overflow-hidden rounded-3xl border px-5 py-5 transition-all duration-300",
        dark ? "border-white/10 bg-white/5 hover:border-white/30" : "border-white/80 bg-white/95 shadow-lg hover:border-emerald-300/50 hover:shadow-xl"
      )}
    >
      <div className={cn(
        "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100",
        `bg-gradient-to-br ${meta.accent}`
      )} />
      <div className="relative flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide opacity-60">{meta.label}</p>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-semibold">{displayValue}</span>
              <span className="text-sm opacity-60">{meta.unit}</span>
            </div>
            {showDelta ? (
              <span className={cn(
                "mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                (delta ?? 0) > 0 ? "bg-emerald-500/15 text-emerald-200" : "bg-sky-500/15 text-sky-200"
              )}>
                {(delta ?? 0) > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {(delta ?? 0) > 0 ? "+" : ""}{Math.abs(delta ?? 0).toFixed(meta.unit === "°C" ? 1 : 0)} {meta.unit}
              </span>
            ) : (
              <span className="mt-2 text-xs opacity-50">Stabil • 5 menit terakhir</span>
            )}
          </div>
          <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl border", meta.glow)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <Sparkline points={history} stroke={stroke} fill={fill} />
      </div>
    </motion.div>
  );
}

function LiveTile({ metric, label, value, delta, history, dark }: {
  metric: Metric;
  label: string;
  value: string;
  delta: number | null;
  history: number[];
  dark: boolean;
}) {
  const showDelta = delta != null && Math.abs(delta) > 0.01;
  const palette = metricPalette[metric];
  const stroke = dark ? palette.strokeDark : palette.strokeLight;
  const fill = dark ? palette.fillDark : palette.fillLight;
  return (
    <div className={cn(
      "group relative overflow-hidden rounded-2xl border px-4 py-3 transition-colors",
      dark ? "border-white/10 bg-white/5 hover:border-white/30" : "border-neutral-200 bg-white hover:border-emerald-200/80 hover:bg-emerald-50/40"
    )}>
      <div className={cn(
        "absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100",
        `bg-gradient-to-br ${metricInfo[metric].accent}`
      )} />
      <div className="relative flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide opacity-60">{label}</p>
          <p className="mt-1 text-lg font-semibold">{value}</p>
          {showDelta ? (
            <span className={cn(
              "mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
              (delta ?? 0) > 0 ? "bg-emerald-500/15 text-emerald-200" : "bg-sky-500/15 text-sky-200"
            )}>
              {(delta ?? 0) > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {(delta ?? 0) > 0 ? "+" : ""}{Math.abs(delta ?? 0).toFixed(metricInfo[metric].unit === "°C" ? 1 : 0)}
            </span>
          ) : (
            <span className="mt-2 inline-block text-xs opacity-50">Stabil</span>
          )}
        </div>
        <Sparkline points={history} stroke={stroke} fill={fill} />
      </div>
    </div>
  );
}

function Sparkline({ points, stroke, fill }: { points: number[]; stroke: string; fill: string }) {
  const safePoints = points.filter((value) => typeof value === "number" && !Number.isNaN(value));
  if (!safePoints.length) {
    return <div className="h-16 w-32 opacity-30" />;
  }
  const sample = safePoints.slice(-20);
  const width = 120;
  const height = 40;
  const min = Math.min(...sample);
  const max = Math.max(...sample);
  const range = max - min || 1;
  const step = sample.length > 1 ? (width - 6) / (sample.length - 1) : width;
  const path = sample.map((value, idx) => {
    const x = 3 + idx * step;
    const normalized = (value - min) / range;
    const y = height - 3 - normalized * (height - 6);
    return `${idx === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  const lastX = 3 + (sample.length > 1 ? (sample.length - 1) * step : 0);
  const area = `${path} L${lastX.toFixed(2)} ${(height - 3).toFixed(2)} L3 ${(height - 3).toFixed(2)} Z`;
  return (
    <svg className="h-16 w-28" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-hidden="true">
      <path d={area} fill={fill} opacity={0.7} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EmptyState({onAdd}:{onAdd:()=>void}){
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-dashed border-emerald-400/40 bg-emerald-500/10 p-6 text-center"
    >
      <p className="text-sm leading-relaxed opacity-80">Belum ada rules. Buat automation pertamamu untuk mengotomatiskan pompa.</p>
      <Button onClick={onAdd} className="mt-4 gap-2">
        <Plus className="h-4 w-4" />
        Tambah Rule
      </Button>
    </motion.div>
  );
}

function RuleRow({ rule, index, onChange, onRemove, evaluate, onRun, dark }: {
  rule: Rule;
  index: number;
  onChange: (patch: Partial<Rule>) => void;
  onRemove: () => void;
  evaluate: () => { ok: boolean; reason: string };
  onRun: () => void;
  dark: boolean;
}) {
  const res = evaluate();
  const meta = metricInfo[rule.metric];
  const Icon = meta.icon;
  const metricList: Metric[] = metricOrder;
  const comparatorList: Comparator[] = [">=", "<="];
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "group relative overflow-hidden rounded-3xl border px-5 py-5 transition-colors",
        dark ? "border-white/10 bg-white/5 hover:border-white/30" : "border-neutral-200 bg-white hover:border-emerald-200/70 hover:bg-emerald-50/40"
      )}
    >
      <div className={cn(
        "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100",
        `bg-gradient-to-br ${meta.accent}`
      )} />
      <div className="relative flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl border", meta.glow)}>
              <Icon className="h-5 w-5" />
            </div>
            <Input
              value={rule.name}
              onChange={(e) => onChange({ name: e.target.value })}
              className={cn(
                "h-9 w-full max-w-[220px] border-transparent bg-transparent text-base font-medium focus-visible:ring-emerald-400/40 focus-visible:ring-offset-0",
                dark ? "text-white placeholder:text-white/40" : "text-neutral-900"
              )}
              placeholder="Nama Rule"
            />
            <span className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide",
              rule.enabled ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200" : "border-amber-400/40 bg-amber-500/10 text-amber-200"
            )}>
              {rule.enabled ? "Aktif" : "Nonaktif"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs opacity-60">#{index + 1}</span>
            <Switch checked={rule.enabled} onCheckedChange={(v) => onChange({ enabled: v })} />
            <Button variant="destructive" size="icon" onClick={onRemove}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="flex flex-col gap-1">
            <Label className="text-xs uppercase tracking-wide opacity-70">Metric</Label>
            <select
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40",
                dark ? "border-white/10 bg-white/5" : "border-neutral-200 bg-white"
              )}
              value={rule.metric}
              onChange={(e) => onChange({ metric: e.target.value as Metric })}
            >
              {metricList.map((m) => (
                <option key={m} value={m}>{metricInfo[m].label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs uppercase tracking-wide opacity-70">Kondisi</Label>
            <select
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40",
                dark ? "border-white/10 bg-white/5" : "border-neutral-200 bg-white"
              )}
              value={rule.comparator}
              onChange={(e) => onChange({ comparator: e.target.value as Comparator })}
            >
              {comparatorList.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs uppercase tracking-wide opacity-70">Nilai {metricInfo[rule.metric].unit}</Label>
            <Input
              type="number"
              value={String(rule.value)}
              onChange={(e) => onChange({ value: Number(e.target.value) })}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm focus-visible:ring-emerald-400/40 focus-visible:ring-offset-0",
                dark ? "border-white/10 bg-white/5" : "border-neutral-200 bg-white"
              )}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs uppercase tracking-wide opacity-70">Stabil (detik)</Label>
            <Input
              type="number"
              value={String(rule.forSeconds ?? 0)}
              onChange={(e) => onChange({ forSeconds: Number(e.target.value) })}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm focus-visible:ring-emerald-400/40 focus-visible:ring-offset-0",
                dark ? "border-white/10 bg-white/5" : "border-neutral-200 bg-white"
              )}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs uppercase tracking-wide opacity-70">Aksi</Label>
            <select
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40",
                dark ? "border-white/10 bg-white/5" : "border-neutral-200 bg-white"
              )}
              value={rule.action}
              onChange={(e) => onChange({ action: e.target.value as Action })}
            >
              <option value="pump_on">Pompa ON</option>
              <option value="pump_off">Pompa OFF</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs uppercase tracking-wide opacity-70">Durasi aksi (detik)</Label>
            <Input
              type="number"
              value={String(rule.runSeconds ?? 0)}
              onChange={(e) => onChange({ runSeconds: Number(e.target.value) })}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm focus-visible:ring-emerald-400/40 focus-visible:ring-offset-0",
                dark ? "border-white/10 bg-white/5" : "border-neutral-200 bg-white"
              )}
            />
          </div>
        </div>

        <div className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-sm",
          dark ? "border-white/10 bg-white/5" : "border-neutral-200 bg-white/80"
        )}>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
            <span className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide",
              res.ok ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200" : "border-amber-400/40 bg-amber-500/10 text-amber-200"
            )}>
              {res.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {res.ok ? "Siap" : "Belum siap"}
            </span>
            <span className="text-xs opacity-70">• {res.reason}</span>
          </div>
          <Button size="sm" variant="secondary" className="gap-2" onClick={onRun}>
            <Play className="h-4 w-4" />
            Tes Sekarang
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function RulePeek({ rule, index, evaluate, dark }: {
  rule: Rule;
  index: number;
  evaluate: () => { ok: boolean; reason: string };
  dark: boolean;
}) {
  const meta = metricInfo[rule.metric];
  const Icon = meta.icon;
  const evalResult = evaluate();
  const actionLabel = rule.action === "pump_on" ? "Pompa ON" : "Pompa OFF";
  const conditionLabel = `${meta.label} ${rule.comparator} ${rule.value}${meta.unit}`;
  const durationLabel = rule.forSeconds ? `Stabil ${rule.forSeconds}s` : "Langsung";
  return (
    <div className={cn(
      "flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors",
      dark ? "border-white/10 bg-white/5" : "border-neutral-200 bg-white/90"
    )}>
      <div className="flex items-start gap-3">
        <div className={cn("mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl border", meta.glow)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide opacity-60">#{index + 1}</span>
            <span className="font-medium leading-tight">{rule.name || `Rule ${index + 1}`}</span>
          </div>
          <p className="text-xs opacity-70">
            {conditionLabel} • {durationLabel} • {actionLabel}
          </p>
          <p className="text-xs opacity-60">{evalResult.reason}</p>
        </div>
      </div>
      <span className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium uppercase tracking-wide",
        evalResult.ok ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200" : "border-amber-400/40 bg-amber-500/15 text-amber-200"
      )}>
        {evalResult.ok ? "Siap" : "Menunggu"}
      </span>
    </div>
  );
}

function NavItem({ href, icon, label, active=false }: { href?: string; icon: React.ReactNode; label: string; active?: boolean }) {
  const className = cn(
    "group inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-all backdrop-blur",
    active
      ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]"
      : "border-transparent text-neutral-400 hover:border-emerald-400/30 hover:bg-emerald-500/10 hover:text-emerald-300"
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

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <div className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs border", connected?"border-emerald-500/40 text-emerald-300 bg-emerald-500/10":"border-rose-500/40 text-rose-300 bg-rose-500/10") }>
      <span className={cn("h-2 w-2 rounded-full animate-pulse", connected?"bg-emerald-400":"bg-rose-400")} />
      {connected ? <Wifi className="h-3.5 w-3.5"/> : <WifiOff className="h-3.5 w-3.5"/>}
      {connected ? "WS Connected" : "Disconnected"}
    </div>
  );
}

function GradientEdge(){
  return <div className="pointer-events-none absolute -inset-px rounded-[inherit] border border-transparent [mask:linear-gradient(#000,transparent)]" style={{background:"linear-gradient(90deg,rgba(16,185,129,0.3),rgba(99,102,241,0.3))", WebkitMask: "linear-gradient(#000,transparent)"}}/>;
}

function Aurora(){
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <motion.div
        className="absolute -top-1/3 -left-1/4 h-[60vh] w-[60vw] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle at 30% 30%, rgba(16,185,129,0.25), transparent 60%)" }}
        animate={{ x: [0, 40, -20, 0], y: [0, 20, -30, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -bottom-1/3 -right-1/4 h-[55vh] w-[55vw] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle at 70% 70%, rgba(59,130,246,0.18), transparent 60%)" }}
        animate={{ x: [0, -30, 10, 0], y: [0, -10, 25, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

// --- Simple toast system (local, no deps) ---
let toastListeners: ((msg: string) => void)[] = [];
function toast(msg: string){ toastListeners.forEach(fn=>fn(msg)); }
function ToastHost(){
  const [items,setItems] = useState<{id:number; msg:string}[]>([]);
  useEffect(()=>{
    const fn = (msg:string)=>{
      const id = Date.now()+Math.random();
      setItems((arr)=>[...arr,{id,msg}]);
      setTimeout(()=>setItems((arr)=>arr.filter(x=>x.id!==id)), 2400);
    };
    toastListeners.push(fn);
    return ()=>{ toastListeners = toastListeners.filter(f=>f!==fn); };
  },[]);
  return (
    <div className="fixed bottom-4 right-4 space-y-2 z-50">
      {items.map(i=> (
        <motion.div key={i.id} initial={{opacity:0,y:8,scale:0.98}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0}} className="rounded-md px-3 py-2 text-sm shadow border bg-neutral-900/90 text-white border-neutral-700">{i.msg}</motion.div>
      ))}
    </div>
  );
}
