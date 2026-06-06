import { expect, test } from "@playwright/test";

test("main dashboard pages render", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.goto("/countries");
  await expect(page.getByRole("heading", { name: "Country Dashboard" })).toBeVisible();
  await page.goto("/providers");
  await expect(page.getByRole("heading", { name: "Provider Dashboard" })).toBeVisible();
  await page.goto("/raw");
  await expect(page.getByRole("heading", { name: "Raw Data Explorer" })).toBeVisible();
});
