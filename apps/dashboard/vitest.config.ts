import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["app/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    passWithNoTests: true
  }
});
