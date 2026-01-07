
import initSqlJs from 'sql.js';
import { iterateImages, saveImage, getAllKeys } from './dbService';

// Initialize SQL.js
const getSql = async () => {
  return initSqlJs({
    // Ensure the wasm file is loaded from the public directory
    locateFile: (file) => {
      return `/${file}`;
    }
  });
};

const CHUNK_SIZE = 50; // Images per SQLite file to avoid OOM

export async function* exportToSQLiteChunks(onProgress?: (progress: number) => void): AsyncGenerator<Uint8Array, void, unknown> {
  const SQL = await getSql();
  const keys = await getAllKeys();
  const total = keys.length;
  let processed = 0;

  // Process in chunks
  for (let i = 0; i < total; i += CHUNK_SIZE) {
    const db = new SQL.Database();
    try {
      db.run("CREATE TABLE images (id TEXT PRIMARY KEY, base64 TEXT);");
      const stmt = db.prepare("INSERT INTO images VALUES (?, ?);");

      // We need to fetch specific keys for this chunk
      // iterateImages doesn't support seeking easily without scanning, 
      // but dbService isn't efficient for random access by index.
      // However, we have 'keys'. We can use 'getImage' for these specific keys.
      // Note: We need to import 'getImage' from dbService.
      
      // To keep it efficient, we might need to modify dbService to get batch, 
      // but calling getImage in parallel for a batch of 50 is fine.
      
      const chunkKeys = keys.slice(i, i + CHUNK_SIZE);
      const { getImage } = await import('./dbService'); // Dynamic import to avoid circular dependency issues if any
      
      for (const key of chunkKeys) {
        const base64 = await getImage(key);
        if (base64) {
          stmt.run([key, base64]);
        }
        processed++;
        if (onProgress) {
           onProgress(Math.round((processed / total) * 100));
        }
      }
      
      stmt.free();
      yield db.export();
      
    } finally {
      db.close();
    }
  }
}

export const importFromSQLite = async (fileBuffer: ArrayBuffer): Promise<number> => {
  const SQL = await getSql();
  let db;
  
  try {
    // Try to open as SQLite
    db = new SQL.Database(new Uint8Array(fileBuffer));
  } catch (e) {
    // If it fails, it might not be a valid SQLite file
    throw new Error("Invalid SQLite file format.");
  }

  let count = 0;

  try {
    // Check if table exists
    const result = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='images';");
    if (result.length === 0 || result[0].values.length === 0) {
      // Not a valid schema we expect
      throw new Error("Invalid SQLite schema: 'images' table not found.");
    }

    // Read all images
    const stmt = db.prepare("SELECT id, base64 FROM images;");
    while (stmt.step()) {
      const row = stmt.getAsObject();
      await saveImage(row.id as string, row.base64 as string);
      count++;
    }
    stmt.free();
  } finally {
    db.close();
  }
  return count;
};
