// WebSocket via Edge runtime (no 'ws' package)
export const runtime = "edge";

type WS = WebSocket;

// Simpan koneksi di global supaya gak hilang saat HMR/dev reload
const getHub = () => {
  const g = globalThis as unknown as { __WS_HUB?: Set<WS> };
  if (!g.__WS_HUB) g.__WS_HUB = new Set<WS>();
  return g.__WS_HUB;
};

export async function GET(req: Request) {
  // Pastikan ini adalah upgrade ke websocket
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket request", { status: 400 });
  }

  // WebSocketPair adalah API bawaan pada Edge runtime
  // @ts-expect-error: WebSocketPair tidak ada di lib DOM typings TS
  const { 0: client, 1: server } = new WebSocketPair();
  const hub = getHub();

  // Cast to any to access the non-standard 'accept' method on Edge WebSocket
  const ws = server as any;
  ws.accept();

  // Tambahkan ke hub
  hub.add(ws);

  // Kirim hello di awal (sinkron dengan page.tsx kamu)
  ws.send(
    JSON.stringify({
      type: "hello",
      history: [],                 // kalau mau kirim buffer data awal, isi di sini
      pump: false,
      config: { thresholds: {} },
    })
  );

  // (opsional) keepalive/ping biar koneksi tetap hidup
  const timer = setInterval(() => {
    try {
      ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
    } catch {
      // noop
    }
  }, 30000);

  ws.addEventListener("close", () => {
    clearInterval(timer);
    hub.delete(ws);
  });

  ws.addEventListener("message", (event: MessageEvent) => {
    // kalau kamu mau terima pesan dari client, proses di sini
    // contoh: ws.send(JSON.stringify({ type: "echo", data: event.data }));
  });

  // Beri socket ke client
  return new Response(null, {
    status: 101,
    // @ts-expect-error: property 'webSocket' khusus untuk Edge
    webSocket: client,
  });
}
