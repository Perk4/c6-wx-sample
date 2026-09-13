# c6-wx-sample

Host-side walk of an ESP32-C6 weather node. Read a sample, pack a compact radio frame, hand it to a stub transport, decode it back. There is no PCB, no radio, and no dashboard.

This is not [mqtt-air-node](https://github.com/Perk4/mqtt-air-node) (JSON onto an MQTT broker for Home Assistant). It is not [esphome-air-node](https://github.com/Perk4/esphome-air-node) (ESPHome YAML). Those teach a different path. This one teaches sample → frame → publish as firmware would do it before ESP-NOW or 802.15.4 TX.

Source itch: [I Designed and Built My Own DIY Weather Station](https://www.youtube.com/watch?v=p7xNGGxX4lM) (Projecter). Custom-PCB ESP32-C6. Sensors, a firmware frame, then radio. We keep the pipeline and drop the board.

## The four primitives

`src/wx.ts` is the whole pipeline.

| Host | C6 firmware |
| --- | --- |
| `readSample()` | I2C read of temp, humidity, pressure (BME280-class) |
| `encodeFrame(sample)` | Packed struct the radio will send |
| `publish(frame, transport)` | `esp_now_send` / 802.15.4 TX |
| `decodeRoundTrip(fixture)` | Gateway RX, unpack, check the fields |

1. **Sample.** `readSample({ seed, clock })` returns `{ temp_c, humidity_pct, pressure_hpa }`. On the chip this is I2C. Here it is a seeded stub. `clock` is optional and only salts the stub.
2. **Frame.** `encodeFrame(sample)` writes 10 little-endian bytes. Field order after the length byte is magic `"WX1"`, `temp_c`, `humidity_pct`, `pressure_hpa`.
3. **Publish.** `publish(frame, transport)` records the last payload. Transports are `{ kind: "mqtt", topic }` or `{ kind: "udp", host, port }`. Nothing leaves the process.
4. **Round-trip.** `decodeRoundTrip(fixture)` encodes a sample (or accepts raw bytes), publishes, decodes, and checks scale tolerance. A truncated frame is the failing fixture.

## Frame layout

Length-prefixed binary. Little-endian. Total 10 bytes.

| Offset | Type | Field |
| --- | --- | --- |
| 0 | `u8` | length of the rest (always `9`) |
| 1–3 | ASCII | `"WX1"` |
| 4–5 | `i16` | `temp_c * 100` |
| 6–7 | `u16` | `humidity_pct * 100` |
| 8–9 | `u16` | `pressure_hpa * 10` |

Example. `CALM` is 21.6 °C, 47.0 %, 1013.2 hPa.

```
09 57 58 31 70 08 5c 12 94 27
```

A 6-byte slice of that frame is the truncated fixture. Decode reports `truncated` because the length byte still asks for 10 bytes.

Tolerance is one LSB of each scale. 0.01 °C, 0.01 %, 0.1 hPa.

## Run

Needs Node 22 or newer (type stripping, no build step).

```bash
npm install
npm test
npm run typecheck
npm run demo
```

`npm run demo` prints the sample, the hex frame, the MQTT topic, and the decoded fields.
