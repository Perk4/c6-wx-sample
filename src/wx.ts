export type WxSample = {
  temp_c: number;
  humidity_pct: number;
  pressure_hpa: number;
};

export type Clock = () => number;

export type DecodeError =
  | { kind: "truncated"; expected: number; actual: number }
  | { kind: "bad-magic" }
  | { kind: "bad-length"; length: number };

export type DecodeResult =
  | { ok: true; sample: WxSample }
  | { ok: false; error: DecodeError };

export type MqttEnvelope = {
  topic: string;
  payload: Uint8Array;
};

export type UdpDatagram = {
  host: string;
  port: number;
  payload: Uint8Array;
};

export type MqttTransport = {
  kind: "mqtt";
  topic: string;
  last: MqttEnvelope | undefined;
};

export type UdpTransport = {
  kind: "udp";
  host: string;
  port: number;
  last: UdpDatagram | undefined;
};

export type Transport = MqttTransport | UdpTransport;

export const MAGIC = "WX1";
export const PAYLOAD_LEN = 9;
export const FRAME_LEN = 1 + PAYLOAD_LEN;
export const DEFAULT_MQTT_TOPIC = "wx/c6/node1";
export const DEFAULT_UDP_HOST = "127.0.0.1";
export const DEFAULT_UDP_PORT = 4242;

export const TOLERANCE = {
  temp_c: 0.01,
  humidity_pct: 0.01,
  pressure_hpa: 0.1,
} as const;

export const CALM: WxSample = {
  temp_c: 21.6,
  humidity_pct: 47.0,
  pressure_hpa: 1013.2,
};

const SCALE = {
  temp_c: 100,
  humidity_pct: 100,
  pressure_hpa: 10,
} as const;

export function readSample(opts: { seed?: number; clock?: Clock } = {}): WxSample {
  const seed = (opts.seed ?? 1) >>> 0;
  const t = opts.clock?.() ?? 0;
  const u = (salt: number) => unit(seed ^ salt ^ (t & 0xffff));
  return {
    temp_c: roundTo(-8 + u(0x9e3779b9) * 44, 2),
    humidity_pct: roundTo(15 + u(0x85ebca6b) * 80, 2),
    pressure_hpa: roundTo(985 + u(0xc2b2ae35) * 50, 1),
  };
}

export function encodeFrame(sample: WxSample): Uint8Array {
  const temp = Math.round(sample.temp_c * SCALE.temp_c);
  const humidity = Math.round(sample.humidity_pct * SCALE.humidity_pct);
  const pressure = Math.round(sample.pressure_hpa * SCALE.pressure_hpa);
  if (!Number.isFinite(temp) || temp < -32768 || temp > 32767) {
    throw new Error(`temp_c out of range: ${sample.temp_c}`);
  }
  if (!Number.isFinite(humidity) || humidity < 0 || humidity > 10000) {
    throw new Error(`humidity_pct out of range: ${sample.humidity_pct}`);
  }
  if (!Number.isFinite(pressure) || pressure < 0 || pressure > 65535) {
    throw new Error(`pressure_hpa out of range: ${sample.pressure_hpa}`);
  }

  const frame = new Uint8Array(FRAME_LEN);
  const view = new DataView(frame.buffer);
  view.setUint8(0, PAYLOAD_LEN);
  frame[1] = MAGIC.charCodeAt(0);
  frame[2] = MAGIC.charCodeAt(1);
  frame[3] = MAGIC.charCodeAt(2);
  view.setInt16(4, temp, true);
  view.setUint16(6, humidity, true);
  view.setUint16(8, pressure, true);
  return frame;
}

export function decodeFrame(bytes: Uint8Array): DecodeResult {
  if (bytes.length < 1) {
    return { ok: false, error: { kind: "truncated", expected: 1, actual: 0 } };
  }
  const length = bytes[0] ?? 0;
  const expected = 1 + length;
  if (bytes.length < expected) {
    return { ok: false, error: { kind: "truncated", expected, actual: bytes.length } };
  }
  if (length !== PAYLOAD_LEN) {
    return { ok: false, error: { kind: "bad-length", length } };
  }
  if (
    bytes[1] !== MAGIC.charCodeAt(0) ||
    bytes[2] !== MAGIC.charCodeAt(1) ||
    bytes[3] !== MAGIC.charCodeAt(2)
  ) {
    return { ok: false, error: { kind: "bad-magic" } };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    ok: true,
    sample: {
      temp_c: view.getInt16(4, true) / SCALE.temp_c,
      humidity_pct: view.getUint16(6, true) / SCALE.humidity_pct,
      pressure_hpa: view.getUint16(8, true) / SCALE.pressure_hpa,
    },
  };
}

export function createMqttTransport(topic = DEFAULT_MQTT_TOPIC): MqttTransport {
  return { kind: "mqtt", topic, last: undefined };
}

export function createUdpTransport(
  host = DEFAULT_UDP_HOST,
  port = DEFAULT_UDP_PORT,
): UdpTransport {
  return { kind: "udp", host, port, last: undefined };
}

export function publish(frame: Uint8Array, transport: Transport): void {
  const payload = new Uint8Array(frame);
  switch (transport.kind) {
    case "mqtt":
      transport.last = { topic: transport.topic, payload };
      return;
    case "udp":
      transport.last = { host: transport.host, port: transport.port, payload };
      return;
    default: {
      const _never: never = transport;
      throw new Error(`unknown transport: ${JSON.stringify(_never)}`);
    }
  }
}

export function lastPayload(transport: Transport): Uint8Array {
  switch (transport.kind) {
    case "mqtt":
      if (transport.last === undefined) throw new Error("mqtt transport has no payload");
      return transport.last.payload;
    case "udp":
      if (transport.last === undefined) throw new Error("udp transport has no payload");
      return transport.last.payload;
    default: {
      const _never: never = transport;
      throw new Error(`unknown transport: ${JSON.stringify(_never)}`);
    }
  }
}

export function decodeRoundTrip(
  fixture: WxSample | Uint8Array,
  transport: Transport,
): WxSample {
  const frame = isSample(fixture) ? encodeFrame(fixture) : fixture;
  publish(frame, transport);
  const decoded = decodeFrame(lastPayload(transport));
  if (!decoded.ok) {
    throw new Error(`round-trip decode failed: ${formatDecodeError(decoded.error)}`);
  }
  if (isSample(fixture) && !withinTolerance(fixture, decoded.sample)) {
    throw new Error(
      `round-trip exceeded tolerance: ${JSON.stringify(fixture)} vs ${JSON.stringify(decoded.sample)}`,
    );
  }
  return decoded.sample;
}

function isSample(fixture: WxSample | Uint8Array): fixture is WxSample {
  return !(fixture instanceof Uint8Array);
}

export function withinTolerance(expected: WxSample, actual: WxSample): boolean {
  return (
    Math.abs(expected.temp_c - actual.temp_c) <= TOLERANCE.temp_c &&
    Math.abs(expected.humidity_pct - actual.humidity_pct) <= TOLERANCE.humidity_pct &&
    Math.abs(expected.pressure_hpa - actual.pressure_hpa) <= TOLERANCE.pressure_hpa
  );
}

export function formatDecodeError(error: DecodeError): string {
  switch (error.kind) {
    case "truncated":
      return `truncated (expected ${error.expected} bytes, got ${error.actual})`;
    case "bad-magic":
      return "bad-magic";
    case "bad-length":
      return `bad-length ${error.length}`;
    default: {
      const _never: never = error;
      throw new Error(`unknown decode error: ${JSON.stringify(_never)}`);
    }
  }
}

function unit(seed: number): number {
  let x = seed >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 0x1_0000_0000;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
