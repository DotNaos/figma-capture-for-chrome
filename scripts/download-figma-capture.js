// @ts-check
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CAPTURE_SCRIPT_URL =
    'https://mcp.figma.com/mcp/html-to-design/capture.js';
const CAPTURE_GLOBAL = '__figmaCaptureExtension';
const __dirname = dirname(fileURLToPath(import.meta.url));
const vendorPath = resolve(__dirname, '../src/vendor/capture.js');

mkdirSync(dirname(vendorPath), { recursive: true });

try {
    const response = await fetch(CAPTURE_SCRIPT_URL);
    if (!response.ok) {
        throw new Error(
            `Failed to download capture.js: ${response.status} ${response.statusText}`,
        );
    }

    const script = await response.text();
    const vendoredScript = script.replaceAll(
        'window.figma',
        `window.${CAPTURE_GLOBAL}`,
    );

    writeFileSync(vendorPath, vendoredScript, 'utf8');
    console.log(`Vendored Figma capture script → ${vendorPath}`);
} catch (error) {
    if (existsSync(vendorPath)) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
            `Using existing vendored capture.js because download failed: ${message}`,
        );
    } else {
        throw error;
    }
}
