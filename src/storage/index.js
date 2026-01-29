import path from "path";
import { JsonStore } from "./jsonStore.js";

export function createStores({ dataDir }) {
  const postsMemory = new JsonStore(path.join(dataDir, "posts_memory.json"), []);
  const validationStats = new JsonStore(path.join(dataDir, "validation_stats.json"), {
    totalAttempts: 0,
    failedAttempts: 0,
    reasons: {},
  });
  const imagesUsed = new JsonStore(path.join(dataDir, "images_used.json"), {});
  const unsplashUsed = new JsonStore(path.join(dataDir, "unsplash_used.json"), { ids: [] });

  return {
    postsMemory,
    validationStats,
    imagesUsed,
    unsplashUsed,
  };
}
