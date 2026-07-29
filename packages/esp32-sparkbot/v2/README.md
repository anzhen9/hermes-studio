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

## Build

Install ESP-IDF `>=5.5.2`, activate its environment, then run:

```powershell
cd packages/esp32-sparkbot/v2
idf.py set-target esp32s3
idf.py build
idf.py -p COM4 flash monitor
```

## Wake word

The user-facing wake word is `嘿，小方`, configured through
`CONFIG_HERMES_WAKE_WORD_DISPLAY`. The v2 runtime registers the matching pinyin
command `hei xiao fang` from `CONFIG_HERMES_WAKE_WORD_COMMAND` with ESP-SR
MultiNet. On recognition it starts a four-second Socket.IO voice-stream capture
without a button hold. The selected ESP-SR MultiNet model must support that
command; the serial log reports a missing model at boot and button/touch voice
turns remain available in that case.