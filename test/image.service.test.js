import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { paths } from "../server/config/index.js";
import { resolveImageFile, imageCredit } from "../server/services/image.service.js";

test("resolves only files inside the allowed image folders", () => {
  assert.equal(resolveImageFile("local/car.jpg"), path.join(paths.gameImages, "car.jpg"));
  assert.equal(resolveImageFile("cache/pixabay-1.jpg"), path.join(paths.imageCache, "pixabay-1.jpg"));
  assert.equal(resolveImageFile("car.jpg"), path.join(paths.gameImages, "car.jpg"));
  assert.equal(resolveImageFile("local/../../.env"), null);
  assert.equal(resolveImageFile("etc/passwd"), null);
  assert.equal(resolveImageFile("cache/../x"), null);
});

test("credits Pixabay only for cached remote images", () => {
  assert.deepEqual(imageCredit("cache/pixabay-1.jpg"), { name: "Pixabay", url: "https://pixabay.com/" });
  assert.equal(imageCredit("local/car.jpg"), null);
});
