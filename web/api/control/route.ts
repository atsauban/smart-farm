import mqtt from "mqtt";

const MQTT_URL = process.env.MQTT_URL ?? "mqtt://broker.hivemq.com";
const DEVICE_ID = process.env.DEVICE_ID ?? "node-1";

type GlobalMqtt = {
  client: mqtt.MqttClient;
  ready: Promise<void>;
};

const scope = globalThis as typeof globalThis & { __smartfarmMqtt?: GlobalMqtt };

if (!scope.__smartfarmMqtt) {
  const client = mqtt.connect(MQTT_URL);
  const ready = new Promise<void>((resolve, reject) => {
    client.once("connect", () => resolve());
    client.once("error", (err) => reject(err));
  });
  client.on("error", (err) => {
    console.error("[API MQTT] client error", err);
  });
  scope.__smartfarmMqtt = { client, ready };
}

const { client: mqttClient, ready: mqttReady } = scope.__smartfarmMqtt;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await mqttReady;
    const topic = `farm/${DEVICE_ID}/control`;
    await new Promise<void>((resolve, reject) => {
      mqttClient.publish(topic, JSON.stringify({ cmd: "setPump", pump: body.pump }), (err) =>
        err ? reject(err) : resolve(),
      );
    });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[API MQTT] publish control failed", error);
    return new Response(JSON.stringify({ ok: false, error: (error as Error).message ?? "MQTT publish error" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
