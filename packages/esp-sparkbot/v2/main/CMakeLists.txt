idf_component_register(
    SRCS "main.cc" "sparkbot_runtime.cpp"
    INCLUDE_DIRS "."
    REQUIRES arduino-esp32 esp-sr esp-tls esp_partition esp32-camera
)