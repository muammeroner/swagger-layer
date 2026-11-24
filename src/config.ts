import * as fs from "node:fs";
import * as path from "node:path";
import type { CliArgs, RawConfigFile, SwaggerLayerConfig } from "./types.js";
import { isPlainObject } from "./utils.js";

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

const CONFIG_FILENAMES = ["config.json"];

type BooleanArg = "init" | "help" | "versionFlag";
type ValueArg = Exclude<keyof CliArgs, BooleanArg>;

/** Bare tokens / flags that toggle a boolean option. */
const BOOLEAN_ARGS: Record<string, BooleanArg> = {
  init: "init",
  "--help": "help",
  "-h": "help",
  "--version": "versionFlag",
  "-v": "versionFlag",
};

/** Option names (without leading dashes) that take a value. */
const VALUE_ARGS: Record<string, ValueArg> = {
  name: "name",
  n: "name",
  url: "url",
  u: "url",
  file: "file",
  f: "file",
  config: "config",
  c: "config",
  "base-url": "baseUrl",
  baseUrl: "baseUrl",
  prefix: "prefix",
  p: "prefix",
  "export-path": "exportPath",
  exportPath: "exportPath",
  output: "exportPath",
  o: "exportPath",
  "api-version": "apiVersion",
  apiVersion: "apiVersion",
  "http-client": "httpClient",
  httpClient: "httpClient",
  exclude: "exclude",
  e: "exclude",
};

export function parseArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const result: CliArgs = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    const booleanKey = Object.hasOwn(BOOLEAN_ARGS, token) ? BOOLEAN_ARGS[token] : undefined;
    if (booleanKey) {
      result[booleanKey] = true;
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

    const valueKey = Object.hasOwn(VALUE_ARGS, rawKey) ? VALUE_ARGS[rawKey] : undefined;
    if (!valueKey) {
      throw new Error(`Unknown argument: --${rawKey}`);
    }
    result[valueKey] = value;
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

  return (
    CONFIG_FILENAMES.map((candidate) => path.resolve(root, candidate))
      .filter((fullPath) => fs.existsSync(fullPath))
      .map((fullPath) => ({ fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs }))
      // Sort oldest to newest so the most recently edited config file overrides older ones
      .sort((a, b) => a.mtimeMs - b.mtimeMs)
      .map((f) => f.fullPath)
  );
}

export function resolveConfigFilePath(root: string, explicitConfig?: string): string | undefined {
  const paths = resolveConfigFilePaths(root, explicitConfig);
  return paths[paths.length - 1];
}

/** Returns the swagger-layer section of a config file (or the file itself when flat). */
function selectConfigSection(raw: RawConfigFile): Partial<SwaggerLayerConfig> {
  if (isPlainObject(raw.swaggerLayer)) return raw.swaggerLayer;
  if (isPlainObject(raw.swaggerFlow)) return raw.swaggerFlow;
  return raw;
}

function readFileConfig(configPaths: string[]): Partial<SwaggerLayerConfig> {
  let fileConfig: Partial<SwaggerLayerConfig> = {};

  for (const configPath of configPaths) {
    const parsed: unknown = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!isPlainObject(parsed)) {
      throw new Error(`Configuration in ${configPath} must be a JSON object`);
    }
    fileConfig = { ...fileConfig, ...selectConfigSection(parsed as RawConfigFile) };
  }

  return fileConfig;
}

function parseExcludeArg(exclude: string): string[] {
  return exclude
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function assertString(value: unknown, name: string, { nonEmpty = false } = {}): void {
  const valid = typeof value === "string" && (!nonEmpty || value.trim().length > 0);
  if (!valid) {
    throw new Error(`${name} must be a ${nonEmpty ? "non-empty " : ""}string`);
  }
}

function validateConfig(config: SwaggerLayerConfig): void {
  const { excludedModules } = config;
  if (!Array.isArray(excludedModules) || !excludedModules.every((x) => typeof x === "string")) {
    throw new Error("excludedModules must be an array of strings");
  }
  assertString(config.exportPath, "exportPath", { nonEmpty: true });
  assertString(config.prefix, "prefix");
  assertString(config.baseUrl, "baseUrl");
  assertString(config.version, "version", { nonEmpty: true });
  assertString(config.httpClient, "httpClient", { nonEmpty: true });
}

/**
 * Resolves the final configuration.
 * Precedence: CLI args > programmatic overrides > config file > defaults.
 */
export function readConfig(
  root: string,
  args: CliArgs = {},
  overrides: Partial<SwaggerLayerConfig> = {}
): SwaggerLayerConfig {
  const fileConfig = readFileConfig(resolveConfigFilePaths(root, args.config));

  const pick = <K extends keyof SwaggerLayerConfig>(
    key: K,
    cliValue?: SwaggerLayerConfig[K]
  ): SwaggerLayerConfig[K] =>
    (cliValue ?? overrides[key] ?? fileConfig[key] ?? DEFAULT_CONFIG[key]) as SwaggerLayerConfig[K];

  const config: SwaggerLayerConfig = {
    baseUrl: pick("baseUrl", args.baseUrl),
    prefix: pick("prefix", args.prefix),
    exportPath: pick("exportPath", args.exportPath),
    version: pick("version", args.apiVersion),
    input: pick("input"),
    excludedModules: args.exclude
      ? parseExcludeArg(args.exclude)
      : overrides.excludedModules ?? fileConfig.excludedModules ?? [...DEFAULT_CONFIG.excludedModules],
    httpClient: pick("httpClient", args.httpClient),
    swaggerUrlTemplate: pick("swaggerUrlTemplate"),
    defaultName: pick("defaultName"),
  };

  validateConfig(config);
  return config;
}

function readJsonObjectIfExists(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    // Invalid JSON will be overwritten
    return {};
  }
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

  const output = {
    ...readJsonObjectIfExists(targetPath),
    swaggerLayer: swaggerLayerConfig,
  };

  fs.writeFileSync(targetPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  return targetPath;
}
