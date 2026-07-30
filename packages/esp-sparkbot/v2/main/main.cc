#include <Arduino.h>

extern void setup();
extern void loop();

extern "C" void app_main() {
  initArduino();
  setup();
  for (;;) loop();
}