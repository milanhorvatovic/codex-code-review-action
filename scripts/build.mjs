import { build } from "esbuild";

const shared = {
  bundle: true,
  loader: {
    ".md": "text",
  },
  minify: true,
  platform: "node",
  target: "node24",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/prepare/main.ts"],
    outfile: "dist/prepare/main.js",
  }),
  build({
    ...shared,
    entryPoints: ["src/publish/main.ts"],
    outfile: "dist/publish/main.js",
  }),
]);
