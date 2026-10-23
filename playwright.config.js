// Browser tests run against the built site, served exactly as Pages would
// serve it (see tools/serve.mjs). Build first: `npm run build && npm test`.
import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Lets a machine with a preinstalled Chromium use it instead of
        // downloading one (CI installs its own with `playwright install`).
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
    // The layout tests also run in WebKit, Safari's engine, since layout is
    // where browsers differ most and the apps are used on iPads (flags of
    // unusual shapes once stretched the Flags grid there). CI always runs
    // them; locally they run with PW_WEBKIT=1, after
    // `npx playwright install webkit`.
    ...(process.env.CI || process.env.PW_WEBKIT
      ? [{ name: "webkit", testMatch: /flag-shapes/, use: { ...devices["Desktop Safari"] } }]
      : []),
  ],
  webServer: {
    command: `node tools/serve.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
