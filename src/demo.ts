import {
  createMqttTransport,
  decodeRoundTrip,
  encodeFrame,
  readSample,
} from "./wx.ts";

const sample = readSample({ seed: 1, clock: () => 0 });
const transport = createMqttTransport();
const decoded = decodeRoundTrip(sample, transport);
const frame = encodeFrame(sample);

process.stdout.write(
  [
    `sample   ${JSON.stringify(sample)}`,
    `frame    ${hex(frame)}`,
    `mqtt     ${transport.last?.topic} ${hex(frame)}`,
    `decoded  ${JSON.stringify(decoded)}`,
    "",
  ].join("\n"),
);

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}
