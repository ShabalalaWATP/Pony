// Regenerate sized logo assets from apps/frontend/public/logo.png.
// Run with: node scripts/regenerate-logos.mjs
// Requires `sharp` (installed transiently via npx if not local).
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "apps", "frontend", "public");
const source = join(publicDir, "logo.png");

const targets = [
  { out: "logo-192.png", size: 192 },
  { out: "logo-256.png", size: 256 },
  { out: "logo-512.png", size: 512 },
  { out: "apple-touch-icon.png", size: 180 },
  { out: "favicon-32.png", size: 32 },
  { out: "favicon-16.png", size: 16 },
];

for (const { out, size } of targets) {
  const dest = join(publicDir, out);
  await sharp(source)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(dest);
  // eslint-disable-next-line no-console
  console.log(`wrote ${out} (${size}x${size})`);
}
