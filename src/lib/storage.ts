import { promises as fs } from "node:fs";
import path from "node:path";

export interface StorageProvider {
  upload(key: string, data: Buffer, contentType: string): Promise<void>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalStorage implements StorageProvider {
  private basePath: string;
  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async upload(key: string, data: Buffer, _contentType: string): Promise<void> {
    const filePath = path.join(this.basePath, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }

  async download(key: string): Promise<Buffer> {
    return fs.readFile(path.join(this.basePath, key));
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(path.join(this.basePath, key)).catch(() => {});
  }
}

function createStorage(): StorageProvider {
  const uploadsDir = path.join(process.cwd(), "uploads");
  return new LocalStorage(uploadsDir);
}

export const storage = createStorage();
