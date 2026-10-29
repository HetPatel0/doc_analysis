import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

try {
  const pdfjsPackage = require.resolve("pdfjs-dist/package.json");
  const source = path.join(
    path.dirname(pdfjsPackage),
    "build",
    "pdf.worker.min.mjs"
  );
  const publicDir = path.join(projectRoot, "public");

  await mkdir(publicDir, { recursive: true });
  await copyFile(source, path.join(publicDir, "pdf.worker.min.mjs"));
  console.log("Copied pdf.js worker to public/pdf.worker.min.mjs");
} catch (error) {
  console.warn(
    "Could not copy the pdf.js worker:",
    error instanceof Error ? error.message : error
  );
}
