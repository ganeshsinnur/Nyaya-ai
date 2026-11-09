// Usage: node scripts/ingest.mjs knowledge/manifest.json
// manifest.json: [{ "file": "cpa2019.pdf" | "cpa2019.txt", "documentTitle": "...", "actName": "...",
//   "sourceType": "legislation", "sourceUrl": "https://indiacode.nic.in/...", "lastVerifiedDate": "2026-01-01" }]
// Files are resolved relative to the manifest. Download official PDFs from indiacode.nic.in / egazette.gov.in yourself.
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { connectDatabase } from "../src/config/db.js";
import { IngestionService } from "../src/services/rag/ingestion.service.js";

const manifestPath = path.resolve(process.argv[2] || "knowledge/manifest.json");
const items = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
await connectDatabase();
for (const { file, ...meta } of items) {
  const p = path.resolve(path.dirname(manifestPath), file);
  if (!fs.existsSync(p)) { console.log(`SKIP ${file}: file not found in ${path.dirname(manifestPath)}`); continue; }
  const res = p.endsWith(".pdf")
    ? await IngestionService.ingestPdf(fs.readFileSync(p), meta)
    : await IngestionService.ingestText(fs.readFileSync(p, "utf8"), meta);
  console.log(file, res);
}
await mongoose.disconnect();
