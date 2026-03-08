// @ts-check
import esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

execFileSync(process.execPath, ['scripts/download-figma-capture.js'], {
    stdio: 'inherit',
});

const sharedOptions = /** @type {import("esbuild").BuildOptions} */ ({
    bundle: true,
    minify: true,
    target: 'chrome109',
    logLevel: 'info',
});

await esbuild.build({
    ...sharedOptions,
    entryPoints: ['src/popup.ts'],
    outfile: 'dist/popup.js',
});

await esbuild.build({
    ...sharedOptions,
    entryPoints: ['src/content.ts'],
    outfile: 'dist/content.js',
});

cpSync('src/popup.html', 'dist/popup.html');
cpSync('src/icons', 'dist/icons', { recursive: true });
cpSync('manifest.json', 'dist/manifest.json');

execFileSync(
    npxCommand,
    [
        '@tailwindcss/cli',
        '-i',
        './src/popup.css',
        '-o',
        './dist/popup.css',
        '--minify',
    ],
    { stdio: 'inherit' },
);

console.log('Build complete → dist/');
