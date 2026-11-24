#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultConfigFile, parseArgs } from "../config.js";
import { generateApi } from "../generator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HELP_TEXT = `swagger-layer - OpenAPI / Swagger JSON to TypeScript Fetch API, Repository & Service Generator

Usage:
  swagger-layer [options]
  swagger-layer init [--config config.json]

Options:
  init                       Create a default config.json file with "swaggerLayer" configuration
  -f, --file <FILE>          Read OpenAPI / Swagger JSON from local file path
  -u, --url <URL>            Fetch OpenAPI / Swagger JSON from remote URL
  -c, --config <FILE>        Path to JSON configuration file (default: config.json)
  --base-url <URL>           Override API baseUrl (e.g. https://api.example.com)
  -p, --prefix <PREFIX>      Override Repository & Service class prefix (e.g. App, Rg)
  -o, --export-path <DIR>    Override target output directory (e.g. src/api)
  --api-version <VER>        Override default API version header (e.g. 1.0)
  --http-client <PATH>       HTTP client import path used in generated api.ts (e.g. "../https.ts" or "@/lib/https")
  -e, --exclude <A,B>        Comma-separated tags/modules to exclude
  -n, --name <NAME>          Subdomain/service name for swaggerUrlTemplate
  -h, --help                 Display this help message
  -v, --version              Display package version`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  if (args.versionFlag) {
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version: string };
    console.log(pkg.version);
    return;
  }

  if (args.init) {
    const target = createDefaultConfigFile(process.cwd(), args.config || "config.json");
    console.log(`✓ Created configuration file: ${target}`);
    return;
  }

  await generateApi({ args });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[swagger-layer]", message);
  process.exitCode = 1;
});
