# ESP-SparkBot firmware v2 (ESP-IDF)

This is the ESP-IDF implementation for the ESP-SparkBot ESP32-S3 (16 MB QIO
flash and 8 MB octal PSRAM). It replaces the PlatformIO/Arduino toolchain used
by v1 while retaining its Hermes-facing contracts:

- `HStudio-WIFI` Wi-Fi fallback portal and persistent credentials
- local status and health endpoints
- UDP `hermes.discover` discovery on port `48640`
- Hermes MCU login at `/api/auth/mcu-login`
- version-isolated SparkBot OTA manifest at
  `/api/hermes/mcu/sparkbot/firmware/v2/manifest`
- ES8311/I2S microphone and DAC setup, ST7789 240x240 display setup, boot and
  touch input pin allocation, plus the v1 voice-turn/session integration hooks

## Hardware requirement

ESP-SparkBot v2 currently targets boards starting from `ESP32-S3-N16R8`.

- Minimum supported flash/PSRAM: `16 MB flash + 8 MB PSRAM`
- Recommended module class: `ESP32-S3-N16R8`

The current partition layout keeps two OTA app slots and also reserves a
dedicated pet spritesheet cache partition plus a separate ESP-SR model
partition. With the shipped v2 partition table, `8 MB flash` devices are not
supported.

In practice this means:

- `ESP32-S3-N16R8`: supported by the current v2 layout
- `ESP32-S3-N8R8` or other `8 MB flash` variants: not supported by the current
  v2 layout

If an `8 MB flash` target is needed later, it requires a different storage
plan such as dropping dual OTA, shrinking or removing pet cache, or redesigning
resource partitions.

## Build

Install ESP-IDF `>=5.5.2`, activate its environment, then run:

```powershell
cd packages/esp32-sparkbot/v2
idf.py set-target esp32s3
idf.py build
idf.py -p COM4 flash monitor
```

## Wake word

The user-facing wake word is `小方小方`, configured through
`CONFIG_HERMES_WAKE_WORD_DISPLAY`. The v2 runtime registers the matching pinyin
command `xiao fang xiao fang` from `CONFIG_HERMES_WAKE_WORD_COMMAND` with ESP-SR
MultiNet. On recognition it starts a four-second Socket.IO voice-stream capture
without a button hold. The selected ESP-SR MultiNet model must support that
command; the serial log reports a missing model at boot and button/touch voice
turns remain available in that case.