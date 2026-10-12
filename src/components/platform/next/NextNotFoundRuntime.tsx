"use client";

import { AppRuntime } from "../../AppRuntime";
import { BrowserPlatformProvider } from "../browser";
import FourOhFourScreen from "../../../screens/FourOhFourScreen";

export const NextNotFoundRuntime = () => (
  <BrowserPlatformProvider>
    <AppRuntime>
      <FourOhFourScreen />
    </AppRuntime>
  </BrowserPlatformProvider>
);
