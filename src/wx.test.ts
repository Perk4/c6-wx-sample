import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CALM,
  FRAME_LEN,
  PAYLOAD_LEN,
  createMqttTransport,
  createUdpTransport,
  decodeFrame,
  decodeRoundTrip,
  encodeFrame,
  lastPayload,
  publish,
  readSample,
  withinTolerance,
  type DecodeError,
  type WxSample,
} from "./wx.ts";

const CALM_FRAME = Uint8Array.from([
  PAYLOAD_LEN,
  0x57, 0x58, 0x31,
  0x70, 0x08,
  0x5c, 0x12,
  0x94, 0x27,
]);

const TRUNCATED: Uint8Array = CALM_FRAME.subarray(0, 6);

test("readSample: same seed and clock return the same reading", () => {
  const clock = () => 1_700_000_000_000;
  const a = readSample({ seed: 7, clock });
  const b = readSample({ seed: 7, clock });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, readSample({ seed: 8, clock }));
  assertFiniteSample(a);
});

test("encodeFrame: length-prefixed WX1 field order is magic, temp, humidity, pressure", () => {
  const frame = encodeFrame(CALM);
  assert.equal(frame.length, FRAME_LEN);
  assert.deepEqual(frame, CALM_FRAME);
});

test("encodeFrame: negative temp_c is a little-endian int16", () => {
  const sample: WxSample = { temp_c: -4.2, humidity_pct: 88.5, pressure_hpa: 998.1 };
  const frame = encodeFrame(sample);
  const view = new DataView(frame.buffer);
  assert.equal(view.getInt16(4, true), -420);
  assert.equal(view.getUint16(6, true), 8850);
  assert.equal(view.getUint16(8, true), 9981);
});

test("publish: mqtt records topic and last payload; udp records host, port, payload", () => {
  const frame = encodeFrame(CALM);
  const mqtt = createMqttTransport("wx/c6/node1");
  publish(frame, mqtt);
  assert.equal(mqtt.last?.topic, "wx/c6/node1");
  assert.deepEqual(mqtt.last?.payload, frame);

  frame[0] = 0xff;
  assert.equal(lastPayload(mqtt)[0], PAYLOAD_LEN);

  const udp = createUdpTransport("192.0.2.10", 4242);
  publish(encodeFrame(CALM), udp);
  assert.equal(udp.last?.host, "192.0.2.10");
  assert.equal(udp.last?.port, 4242);
  assert.deepEqual(udp.last?.payload, CALM_FRAME);
});

test("decodeRoundTrip: encode, publish, decode stay within scale tolerance", () => {
  const mqtt = createMqttTransport();
  const decoded = decodeRoundTrip(CALM, mqtt);
  assert.ok(withinTolerance(CALM, decoded));
  assert.deepEqual(mqtt.last?.payload, CALM_FRAME);

  const seeded = readSample({ seed: 3, clock: () => 42 });
  const udp = createUdpTransport();
  const round = decodeRoundTrip(seeded, udp);
  assert.ok(withinTolerance(seeded, round));
});

test("decodeRoundTrip: truncated frame fixture fails closed", () => {
  const transport = createMqttTransport();
  assert.throws(() => decodeRoundTrip(TRUNCATED, transport), /truncated/);
  assert.deepEqual(lastPayload(transport), TRUNCATED);

  const result = decodeFrame(TRUNCATED);
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected truncated decode to fail");
  }
  assertTruncated(result.error, FRAME_LEN, TRUNCATED.length);
});

function assertFiniteSample(sample: WxSample): void {
  assert.ok(Number.isFinite(sample.temp_c));
  assert.ok(sample.humidity_pct >= 0 && sample.humidity_pct <= 100);
  assert.ok(sample.pressure_hpa > 800 && sample.pressure_hpa < 1200);
}

function assertTruncated(error: DecodeError, expected: number, actual: number): void {
  switch (error.kind) {
    case "truncated":
      assert.equal(error.expected, expected);
      assert.equal(error.actual, actual);
      return;
    case "bad-magic":
    case "bad-length":
      throw new Error(`expected truncated, got ${error.kind}`);
    default: {
      const _never: never = error;
      throw new Error(`unknown decode error: ${JSON.stringify(_never)}`);
    }
  }
}
