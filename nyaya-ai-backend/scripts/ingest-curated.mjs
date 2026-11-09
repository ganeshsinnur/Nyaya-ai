// Loads a curated, closed knowledge base (kb/sources.json format, from the Nyay Saathi project)
// into the RAG store: one entry -> one document -> embedded chunk(s).
// Usage: node scripts/ingest-curated.mjs [knowledge/curated-sources.json] [--dry]
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { connectDatabase } from "../src/config/db.js";
import { IngestionService } from "../src/services/rag/ingestion.service.js";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const file = path.resolve(args.find((a) => !a.startsWith("--")) || "knowledge/curated-sources.json");
const { entries } = JSON.parse(fs.readFileSync(file, "utf8"));

const toDoc = (e) => {
  const isPractice = /practice|not a statute/i.test(e.verification?.status ?? "") || !e.acts.length;
  const sourceType = isPractice ? "guidance" : /rules/i.test(e.source) ? "rules" : "legislation";
  const sec = e.sections.length === 1 ? e.sections[0] : null;
  const head = sec ? `Section ${sec.n}. ${sec.act}\n\n` : "";
  const note = `\n\n[Reference note: ${e.source}. Confidence: ${e.confidence}. Verification: ${e.verification?.status ?? "n/a"}.]`;
  return {
    text: head + e.en + note,
    meta: {
      documentTitle: `${e.id}: ${e.source}`.slice(0, 290),
      actName: (e.acts[0] || e.source).slice(0, 290),
      sourceType,
      sourceUrl: e.verify,
      lastVerifiedDate: e.verification?.checked_on || "2026-11-08",
      tags: [e.topic, e.id],
    },
  };
};

if (dry) {
  for (const e of entries) { const d = toDoc(e); console.log(e.id, d.meta.sourceType, d.meta.actName, "|", d.text.length, "chars"); }
  process.exit(0);
}
await connectDatabase();
for (const e of entries) {
  const { text, meta } = toDoc(e);
  try { console.log(e.id, await IngestionService.ingestText(text, meta).then((r) => `inserted ${r.inserted}, skipped ${r.skipped}`)); }
  catch (err) { console.log(e.id, "FAILED:", err.message.slice(0, 150)); }
}
await mongoose.disconnect();
