import * as fs from "node:fs";
import * as path from "node:path";
import type { CliArgs, RawConfigFile, SwaggerLayerConfig } from "./types.js";

export const DEFAULT_CONFIG: Readonly<SwaggerLayerConfig> = Object.freeze({
  baseUrl: "https://api.example.com",
  prefix: "App",
  exportPath: "src/api",
  version: "1.0",
  input: "./swagger.json",
  excludedModules: [],
  httpClient: "../https",
  swaggerUrlTemplate: "https://api.example.com/swagger/v1/swagger.json",
  defaultName: "app",
});

const CONFIG_FILENAMES = [
  "config.json",
];

export function parseArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const result: CliArgs = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "init") {
      result.init = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      result.help = true;
      continue;
    }
    if (token === "--version" || token === "-v") {
      result.versionFlag = true;
      continue;
    }
    if (!token.startsWith("-")) {
      throw new Error(`Unknown argument: ${token}`);
    }

    const eq = token.indexOf("=");
    const rawKey = (eq === -1 ? token : token.slice(0, eq)).replace(/^-+/, "");
    const value = eq === -1 ? argv[++i] : token.slice(eq + 1);

    if (!value || value.startsWith("-")) {
      throw new Error(`Missing value for ${token}`);
    }

    switch (rawKey) {
      case "name":
      case "n":
        result.name = value;
        break;
      case "url":
      case "u":
        result.url = value;
        break;
      case "file":
      case "f":
        result.file = value;
        break;
      case "config":
      case "c":
        result.config = value;
        break;
      case "base-url":
      case "baseUrl":
        result.baseUrl = value;
        break;
      case "prefix":
      case "p":
        result.prefix = value;
        break;
      case "export-path":
      case "exportPath":
      case "output":
      case "o":
        result.exportPath = value;
        break;
      case "api-version":
      case "apiVersion":
        result.apiVersion = value;
        break;
      case "http-client":
      case "httpClient":
        result.httpClient = value;
        break;
      case "exclude":
      case "e":
        result.exclude = value;
        break;
      default:
        throw new Error(`Unknown argument: --${rawKey}`);
    }
  }

  return result;
}

export function resolveConfigFilePaths(root: string, explicitConfig?: string): string[] {
  if (explicitConfig) {
    const resolved = path.resolve(root, explicitConfig);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Config file not found: ${resolved}`);
    }
    return [resolved];
  }

  const found: Array<{ fullPath: string; mtimeMs: number }> = [];
  for (const candidate of CONFIG_FILENAMES) {
    const fullPath = path.resolve(root, candidate);
    if (fs.existsSync(fullPath)) {
      found.push({ fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs });
    }
  }

  // Sort oldest to newest so the most recently edited config file overrides older ones
  found.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return found.map((f) => f.fullPath);
}

export function resolveConfigFilePath(root: string, explicitConfig?: string): string | undefined {
  const paths = resolveConfigFilePaths(root, explicitConfig);
  return paths[paths.length - 1];
}

export function readConfig(
  root: string,
  args: CliArgs = {},
  overrides: Partial<SwaggerLayerConfig> = {}
): SwaggerLayerConfig {
  const configPaths = resolveConfigFilePaths(root, args.config);
  let fileConfig: RawConfigFile = {};

  for (const configPath of configPaths) {
    const parsed: unknown = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error(`Configuration in ${configPath} must be a JSON object`);
    }
    const raw = parsed as RawConfigFile;
    const section =
      raw.swaggerLayer && typeof raw.swaggerLayer === "object" && !Array.isArray(raw.swaggerLayer)
        ? raw.swaggerLayer
        : raw.swaggerFlow && typeof raw.swaggerFlow === "object" && !Array.isArray(raw.swaggerFlow)
          ? raw.swaggerFlow
          : raw;
    fileConfig = { ...fileConfig, ...section };
  }

  const baseUrl =
    args.baseUrl ?? overrides.baseUrl ?? fileConfig.baseUrl ?? DEFAULT_CONFIG.baseUrl;
  const prefix =
    args.prefix ?? overrides.prefix ?? fileConfig.prefix ?? DEFAULT_CONFIG.prefix;
  const exportPath =
    args.exportPath ?? overrides.exportPath ?? fileConfig.exportPath ?? DEFAULT_CONFIG.exportPath;
  const version =
    args.apiVersion ?? overrides.version ?? fileConfig.version ?? DEFAULT_CONFIG.version;
  const input = overrides.input ?? fileConfig.input ?? DEFAULT_CONFIG.input;
  const httpClient =
    args.httpClient ?? overrides.httpClient ?? fileConfig.httpClient ?? DEFAULT_CONFIG.httpClient;
  const swaggerUrlTemplate =
    overrides.swaggerUrlTemplate ??
    fileConfig.swaggerUrlTemplate ??
    DEFAULT_CONFIG.swaggerUrlTemplate;
  const defaultName =
    overrides.defaultName ?? fileConfig.defaultName ?? DEFAULT_CONFIG.defaultName;

  const excludedModules = args.exclude
    ? args.exclude
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : overrides.excludedModules ?? fileConfig.excludedModules ?? [...DEFAULT_CONFIG.excludedModules];

  if (!Array.isArray(excludedModules) || !excludedModules.every((x) => typeof x === "string")) {
    throw new Error("excludedModules must be an array of strings");
  }
  if (typeof exportPath !== "string" || !exportPath.trim()) {
    throw new Error("exportPath must be a non-empty string");
  }
  if (typeof prefix !== "string") {
    throw new Error("prefix must be a string");
  }
  if (typeof baseUrl !== "string") {
    throw new Error("baseUrl must be a string");
  }
  if (typeof version !== "string" || !version.trim()) {
    throw new Error("version must be a non-empty string");
  }
  if (typeof httpClient !== "string" || !httpClient.trim()) {
    throw new Error("httpClient must be a non-empty string");
  }

  return {
    baseUrl,
    prefix,
    exportPath,
    version,
    input,
    excludedModules,
    httpClient,
    swaggerUrlTemplate,
    defaultName,
  };
}

export function createDefaultConfigFile(root: string, filename = "config.json"): string {
  const targetPath = path.resolve(root, filename);
  const swaggerLayerConfig = {
    baseUrl: DEFAULT_CONFIG.baseUrl,
    prefix: DEFAULT_CONFIG.prefix,
    exportPath: DEFAULT_CONFIG.exportPath,
    version: DEFAULT_CONFIG.version,
    input: DEFAULT_CONFIG.input,
    httpClient: DEFAULT_CONFIG.httpClient,
    excludedModules: [],
  };

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(targetPath)) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(targetPath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      // Overwrite invalid JSON
    }
  }

  const output = {
    ...existing,
    swaggerLayer: swaggerLayerConfig,
  };

  fs.writeFileSync(targetPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  return targetPath;
}
