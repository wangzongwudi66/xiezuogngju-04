import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    environment: "node",
    hookTimeout: 90_000,
    include: ["app/api/asset-lock-attachments/object-storage.integration.ts"],
    testTimeout: 90_000
  }
});
