# ESP32-S3 Firmware v2

Device name: **SmallDesktopDisplay**.

PlatformIO project for the ESP32-S3 hardware revision (8MB flash, ES8311 audio,
ST7789 240x240 SPI display). Firmware logic is ported 1:1 from the ESP32-C3 v2
application (`packages/esp32-c3/v2/src/main.cpp`) with hardware-layer changes
only, so behavior, voice modes, subtitles, and OTA rules stay identical.

## Hardware

- Chip: ESP32-S3, 8MB flash (WROOM-1 N8R8 class), USB-Serial-JTAG console
- Display: ST7789 240x240 SPI (TFT_eSPI), MOSI GPIO1, SCLK GPIO18, DC GPIO17,
  RST GPIO6, BL GPIO2, RGB order, 40MHz SPI
- Display mapping: all UI drawing keeps the C3's 128x64 logical canvas (U8g2
  `U8G2_NULL` as the font engine); `lcdPresent()` scales it 1.875x to 240x120
  and centers it vertically on the 240x240 panel
- I2C: SDA GPIO40, SCL GPIO39
- I2S: DOUT GPIO4, WS GPIO7, DIN GPIO15, BCK GPIO16, MCLK GPIO38
- User key: GPIO5 touch pad (TTP223-like, idle low / touched high — inverted
  logic vs the C3 BOOT button, adapted via `HERMES_BUTTON_ACTIVE_HIGH`)
- Power amplifier enable: GPIO8
- ES8311 address: `0x18`
- No battery ADC: the board is AC-powered, battery telemetry reports
  `batteryKnown:false` and the status bar shows `AC`

The custom partition table intentionally retains the proven 4MB dual-OTA
layout. The remaining physical flash is left unused until a larger storage or
OTA layout is explicitly required.

## Build notes

- Platform is pinned to `espressif32@6.11.0` (Arduino core 2.0.x). Core 2.0.13+
  and 3.x define `REG_SPI_BASE(i)` in `soc.h`, which returns a zero base for
  i<2 and masks TFT_eSPI's fallback macro; combined with S3's `FSPI=0` this
  computes SPI register addresses as 0 and crashes on the first register write.
  `-D USE_FSPI_PORT=1` forces `SPI_PORT=2` (GPSPI2) and is mandatory.
- `-D ARDUINO_USB_MODE=1 -D ARDUINO_USB_CDC_ON_BOOT=1` route `Serial` to the
  USB-Serial-JTAG port (COM8 on the reference board).

## Commands

```bash
cd packages/esp32-s3/v2
pio run
pio run -t upload
pio device monitor
```

After `pio run`, the firmware binary lands in `.pio/build/esp32-s3-devkitc-1/`.
Repository-level npm copy scripts for this package are not wired yet; use the
PlatformIO commands above until a release pipeline is added.

## Speak Subtitles

Same as the C3 v2 firmware: during MCU speech playback the display renders the
active audio segment's text with the compressed WenQuanYi 12px GB2312 font.
Long text is wrapped into three-line pages. Page timing follows elapsed
playback time capped by queued PCM or ADPCM sample progress, so DMA
prebuffering cannot advance the first page early. The complete audio-segment
text is retained for paging rather than being shortened to the status-preview
length. On the S3 the page flush sends the full scaled frame over SPI instead
of I2C page writes.

## Voice Modes

Same as the C3 v2 firmware: push-to-talk (long press) plus a local automatic
listening mode with on-device VAD, ~250 ms pre-roll, ADPCM uplink opened after
sustained speech-like activity, and a one-second-silence turn end. Listening is
suspended while a turn is transcribing, thinking, using tools, or playing
speech. Single click stops the current response, double click clears the
session.

## Agent Runtime

Same as the C3 v2 firmware: Ekko or Hermes selectable per device, Ekko by
default, stored in MCU preferences and sent with each voice turn. Ekko and
Hermes use separate deterministic session IDs.

## Idle Power Saving

Same as the C3 v2 firmware: after three minutes without a voice, audio, or
status interaction the firmware turns off the display (ST7789 off command plus
backlight) and power amplifier and enables Wi-Fi modem power saving. The
timeout is configurable from 1 to 60 minutes, or 0 to disable. Pressing the
touch key or receiving a new MCU interaction restores the low-latency Wi-Fi
mode and turns the display back on. This is connected standby, not deep sleep.
