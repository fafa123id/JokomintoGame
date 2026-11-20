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

test("never repeats a recently seen picture while others remain", async () => {
  const { default: config } = await import("../server/config/index.js");
  const { IMAGES } = await import("../server/config/game.js");
  const { pickImagePuzzle } = await import("../server/services/image.service.js");
  const key = config.pixabay.apiKey;
  config.pixabay.apiKey = "";
  try {
    const all = IMAGES.map((image) => `local/${image.file}`);
    const [unseen, ...seen] = all;
    for (let i = 0; i < 10; i++) {
      assert.equal((await pickImagePuzzle({ recent: seen })).imageFile, unseen);
    }
    // Everything seen: the picture seen longest ago comes back first.
    assert.equal((await pickImagePuzzle({ recent: all })).imageFile, all.at(-1));
  } finally {
    config.pixabay.apiKey = key;
  }
});
