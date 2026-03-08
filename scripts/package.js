// @ts-check
import { execSync } from "child_process";
import { existsSync, rmSync } from "fs";

const OUT = "figma-capture.zip";

if (existsSync(OUT)) rmSync(OUT);

execSync(`zip -r ../${OUT} .`, { cwd: "dist", stdio: "inherit" });

console.log(`Packaged → ${OUT}`);
