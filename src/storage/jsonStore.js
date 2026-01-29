import fs from "fs";
import path from "path";

export class JsonStore {
  constructor(filePath, defaultData) {
    this.filePath = filePath;
    this.defaultData = defaultData;
    this.ensureFile();
  }

  ensureFile() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify(this.defaultData, null, 2), "utf8");
    }
  }

  read() {
    try {
      if (!fs.existsSync(this.filePath)) return this.defaultData;
      const raw = fs.readFileSync(this.filePath, "utf8");
      return JSON.parse(raw);
    } catch {
      return this.defaultData;
    }
  }

  write(data) {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  update(mutator) {
    const data = this.read();
    const updated = mutator(data) ?? data;
    this.write(updated);
    return updated;
  }
}
