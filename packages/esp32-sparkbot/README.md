# ESP32-S3 ESP-SparkBot Wi-Fi Setup Firmware

PlatformIO source project for the ESP32-S3 Wi-Fi setup firmware, adapted for the
[ESP-SparkBot](https://github.com/espressif2022/esp_sparkbot) hardware platform.

This firmware is adapted from the ESP32-C3 variant. It manages Wi-Fi provisioning,
renders a status/animation UI on the SparkBot's 1.3-inch 240×240 color LCD, and
shows a device tab that can discover Hermes Web UI and desktop endpoints on the
LAN. Voice input via the ES8311 codec, pairing, relay, webhook, OTA, and audio
playback flows are retained from the C3 base.

## Hardware (ESP-SparkBot)

- Chip: ESP32-S3, 16 MB flash, 8 MB Octal PSRAM
- I2C: SDA GPIO4, SCL GPIO5
- Audio codec: ES8311 @ I2C `0x18`
- I2S: BCLK GPIO39, MCLK GPIO45, WS GPIO41, DOUT GPIO42, DIN GPIO40
- LCD: ST7789 240×240 RGB565, SPI3
  - MOSI GPIO47, CLK GPIO21, CS GPIO44, DC GPIO43, BL GPIO46
- Boot button: GPIO0
- Green LED: GPIO3
- Camera: OV2640 (not used in this firmware)
- Power amp: not connected (no speaker on SparkBot)

> The SparkBot has a microphone (ES8311 ADC) but no speaker. Audio playback
> writes to the ES8311 DAC but produces no sound. Voice recording/streaming
> works normally.

## Differences from ESP32-C3 Firmware

| Item | ESP32-C3 | ESP32-S3 SparkBot |
|------|----------|-------------------|
| Chip | ESP32-C3, 4 MB flash | ESP32-S3, 16 MB flash, 8 MB PSRAM |
| Display | SSD1306 128×64 I2C OLED | ST7789 240×240 SPI color LCD |
| I2C pins | SDA=3, SCL=4 | SDA=4, SCL=5 |
| I2S pins | DOUT=5, WS=6, DIN=7, BCK=8, MCK=10 | DOUT=42, WS=41, DIN=40, BCK=39, MCK=45 |
| Boot button | GPIO9 | GPIO0 |
| Power amp | GPIO11 (enabled) | NC (no-op) |
| Status LED | none | GPIO3 (green) |
| Framebuffer | 128×64 monochrome (1 KB) | 240×240 RGB565 (115 KB, PSRAM) |

## Commands

```bash
cd packages/esp32-sparkbot
pio run
pio run -t upload
pio device monitor
```

After `pio run`, the firmware is built at
`packages/esp32-sparkbot/.pio/build/esp32-s3-devkitc-1/firmware.bin`. Copy it into
`packages/esp32-sparkbot/release/firmware.bin` for release packaging.

The current macOS serial port is configured as:

```text
/dev/cu.usbmodem11101
```

If upload fails, hold `BOOT`, start upload, then release it after flashing
begins.

## First Boot

1. The device tries the saved Wi-Fi credentials first.
2. If Wi-Fi is missing or connection fails, it starts the open `HStudio-WIFI`
   setup hotspot.
3. Join `HStudio-WIFI` and open `http://192.168.4.1/`.
4. Select the target Wi-Fi SSID from the scanned list, or enter it manually,
   then enter the password and save.
5. The setup page connects once, shows the router-assigned IP, opens that IP,
   and the device restarts into normal Wi-Fi station mode.

Use `/clear` from the device page to clear saved Wi-Fi and return to setup mode.

## LAN Device Discovery

After Wi-Fi is connected, open the device page and use the `设备` tab. The
firmware sends a UDP `hermes.discover` probe to the fixed Hermes discovery port
`48640`. Hermes Web UI and desktop responders return `hermes.announce` payloads
with their `endpoint_kind` (`web`, `desktop`, or `custom`) and HTTP port, so Web
and desktop endpoints are listed separately.

The device tab also includes an MCU login flow. Select a discovered or manually
added endpoint, enter the Hermes account and password, and the firmware posts to
`/api/auth/mcu-login`. On success it shows the returned profile list, stores the
selected profile locally, and connects to the selected Web UI `/global-agent`
Socket.IO namespace with the returned login token.
