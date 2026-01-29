import fs from "fs";
import path from "path";

const IMAGE_EXT_RE = /\.(jpg|jpeg|png|webp)$/i;

function listImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((file) => IMAGE_EXT_RE.test(file));
}

export function pickLocalImage({ rubric, imagesDir, imagesDirs, usedStore, maxBytes }) {
  const used = usedStore.read();
  const key = rubric || "default";
  if (!used[key]) used[key] = [];
  const dirs = (imagesDirs?.length ? imagesDirs : [imagesDir]).filter(Boolean);
  const searched = [];

  for (const dir of dirs) {
    const rubricDir = path.join(dir, key);
    const baseDir = dir;
    searched.push(rubricDir, baseDir);
    const files = listImages(rubricDir);
    const fallbackFiles = files.length ? files : listImages(baseDir);

    if (!fallbackFiles.length) continue;

    const available = fallbackFiles.filter((f) => !used[key].includes(f));
    const pool = available.length ? available : fallbackFiles;

    let chosen = null;
    let filePath = null;
    for (let i = 0; i < pool.length; i += 1) {
      const candidate = pool[Math.floor(Math.random() * pool.length)];
      const candidatePath = files.length ? path.join(rubricDir, candidate) : path.join(baseDir, candidate);
      const size = fs.statSync(candidatePath).size;
      if (!maxBytes || size <= maxBytes) {
        chosen = candidate;
        filePath = candidatePath;
        break;
      }
    }

    if (!chosen || !filePath) {
      throw new Error("Local image too large for Telegram limit");
    }

    used[key].push(chosen);
    if (used[key].length >= fallbackFiles.length) used[key] = [];
    usedStore.write(used);

    return filePath;
  }

  throw new Error(`No local images found in ${searched.join(" or ")}`);
}

export function contentTypeFromPath(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}
