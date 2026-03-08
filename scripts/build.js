// @ts-check
import esbuild from "esbuild";
import { cpSync, mkdirSync } from "fs";

mkdirSync("dist", { recursive: true });

const sharedOptions = /** @type {import("esbuild").BuildOptions} */ ({
  bundle: true,
  minify: true,
  target: "chrome109",
  logLevel: "info",
});

await Promise.all([
  esbuild.build({
    ...sharedOptions,
    entryPoints: ["src/popup.ts"],
    outfile: "dist/popup.js",
  }),
  esbuild.build({
    ...sharedOptions,
    entryPoints: ["src/content.ts"],
    outfile: "dist/content.js",
  }),
  esbuild.build({
    ...sharedOptions,
    entryPoints: ["src/injected.ts"],
    outfile: "dist/injected.js",
  }),
]);

cpSync("src/popup.html", "dist/popup.html");
cpSync("src/popup.css", "dist/popup.css");
cpSync("manifest.json", "dist/manifest.json");

console.log("Build complete → dist/");
