import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");
const cli = path.join(pkgRoot, "dist", "bin", "swagger-layer.js");
const fixture = path.join(pkgRoot, "example", "swagger.json");
const pkgJson = JSON.parse(
  fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8")
) as { version: string };

test("CLI --help and --version", () => {
  const help = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.match(help, /--base-url/);
  assert.match(help, /--export-path/);
  const version = execFileSync(process.execPath, [cli, "--version"], {
    encoding: "utf8",
  }).trim();
  assert.equal(version, pkgJson.version);
});

test("CLI init creates config.json with swaggerLayer object", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "swagger-layer-init-"));
  try {
    execFileSync(process.execPath, [cli, "init"], { cwd, encoding: "utf8" });
    const configFile = path.join(cwd, "config.json");
    assert.ok(fs.existsSync(configFile));
    const parsed = JSON.parse(fs.readFileSync(configFile, "utf8")) as {
      swaggerLayer: Record<string, unknown>;
    };
    assert.ok(parsed.swaggerLayer);
    assert.equal(parsed.swaggerLayer.baseUrl, "https://api.example.com");
    assert.equal(parsed.swaggerLayer.prefix, "App");
    assert.equal(parsed.swaggerLayer.exportPath, "src/api");
    assert.equal(parsed.swaggerLayer.version, "1.0");
    assert.equal(parsed.swaggerLayer.httpClient, "../https");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("generates enums, types, api.ts, repository.ts, and service.ts using config.json swaggerLayer object", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "swagger-layer-gen-"));
  try {
    fs.writeFileSync(
      path.join(cwd, "config.json"),
      JSON.stringify({
        swaggerLayer: {
          baseUrl: "https://api.acme.dev",
          prefix: "Acme",
          exportPath: "src/generated-api",
          version: "2.0",
          httpClient: "@/lib/api/https",
          excludedModules: [],
        },
      })
    );

    execFileSync(process.execPath, [cli, "--file", fixture], { cwd, encoding: "utf8" });

    const generated = path.join(cwd, "src", "generated-api");
    const expectedFiles = [
      "enums.ts",
      "types.ts",
      "index.ts",
      "user/api.ts",
      "user/repository.ts",
      "user/service.ts",
      "user/index.ts",
    ];

    for (const f of expectedFiles) {
      assert.ok(fs.existsSync(path.join(generated, f)), `Missing generated file: ${f}`);
    }
    assert.ok(!fs.existsSync(path.join(generated, "interfaces.ts")));
    assert.ok(!fs.existsSync(path.join(generated, "http.ts")));

    const enumsContent = fs.readFileSync(path.join(generated, "enums.ts"), "utf8");
    assert.match(enumsContent, /export enum EUserRole \{\n  Admin = 1,\n  Member,\n  Guest,\n\}/);

    const typesContent = fs.readFileSync(path.join(generated, "types.ts"), "utf8");
    assert.match(typesContent, /export interface UserDto/);
    assert.match(typesContent, /fullName\?: string;/);
    assert.doesNotMatch(typesContent, /fullName\?: string \| null;/);
    assert.match(typesContent, /export interface CreateUserRequest/);
    assert.match(typesContent, /export interface ApiErrorResponse/);
    assert.match(typesContent, /export interface RequestConfig/);
    assert.doesNotMatch(typesContent, /interface \w+QueryParams/);

    const apiContent = fs.readFileSync(path.join(generated, "user/api.ts"), "utf8");
    assert.match(apiContent, /from "@\/lib\/api\/https"/);
    assert.match(apiContent, /const DEFAULT_API_URL = "https:\/\/api\.acme\.dev";/);
    assert.match(apiContent, /"2\.0"/);
    assert.match(apiContent, /export async function getUsers\(query\?: \{ page\?: number; role\?: "Admin" \| "Member" \| "Guest" \}\)/);
    assert.match(apiContent, /export async function createUser/);
    assert.match(apiContent, /export async function deleteUser/);
    assert.doesNotMatch(apiContent, /requestConfig/);

    const repoContent = fs.readFileSync(path.join(generated, "user/repository.ts"), "utf8");
    assert.match(repoContent, /export class AcmeUserRepository/);

    const serviceContent = fs.readFileSync(path.join(generated, "user/service.ts"), "utf8");
    assert.match(serviceContent, /export class AcmeUserService/);
    assert.match(serviceContent, /export const userService = new AcmeUserService\(\)/);

    // Provide user's own @/lib/api/https.ts and verify that the generated TypeScript code passes strict tsc typechecking!
    fs.mkdirSync(path.join(cwd, "src", "lib", "api"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, "src", "lib", "api", "https.ts"),
      `import type { ApiErrorResponse, HttpRequestArgs } from "../../generated-api/types";
export async function get<T, E = ApiErrorResponse>(_args: HttpRequestArgs): Promise<T> { return undefined as unknown as T; }
export async function post<T, E = ApiErrorResponse>(_args: HttpRequestArgs): Promise<T> { return undefined as unknown as T; }
export async function put<T, E = ApiErrorResponse>(_args: HttpRequestArgs): Promise<T> { return undefined as unknown as T; }
export async function patch<T, E = ApiErrorResponse>(_args: HttpRequestArgs): Promise<T> { return undefined as unknown as T; }
export async function del<T, E = ApiErrorResponse>(_args: HttpRequestArgs): Promise<T> { return undefined as unknown as T; }
`
    );

    const testTsconfigPath = path.join(cwd, "tsconfig.json");
    fs.writeFileSync(
      testTsconfigPath,
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          paths: {
            "@/*": ["./src/*"],
          },
          lib: ["ES2022", "DOM"],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["src/**/*"],
      })
    );
    const tscBin = path.join(pkgRoot, "node_modules", ".bin", "tsc");
    execFileSync(tscBin, ["-p", testTsconfigPath], { cwd, encoding: "utf8" });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("emits unquoted DEFAULT_API_URL expression when baseUrl is wrapped in ${...}", () => {
  const cases: Array<{ baseUrl: string; expectedLine: string }> = [
    {
      baseUrl: "${process.env.NEXT_PUBLIC_DEFAULT_API_URL}",
      expectedLine: "const DEFAULT_API_URL = process.env.NEXT_PUBLIC_DEFAULT_API_URL;",
    },
    {
      baseUrl: "${value}",
      expectedLine: "const DEFAULT_API_URL = value;",
    },
    {
      baseUrl: "${ process.env.API_URL ?? \"https://fallback.example.com\" }",
      expectedLine: "const DEFAULT_API_URL = process.env.API_URL ?? \"https://fallback.example.com\";",
    },
    {
      baseUrl: "${}",
      expectedLine: "const DEFAULT_API_URL = \"${}\";",
    },
    {
      baseUrl: "${a}/${b}",
      expectedLine: "const DEFAULT_API_URL = \"${a}/${b}\";",
    },
  ];

  for (const { baseUrl, expectedLine } of cases) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "swagger-layer-baseurl-"));
    try {
      fs.writeFileSync(
        path.join(cwd, "config.json"),
        JSON.stringify({
          swaggerLayer: {
            baseUrl,
            prefix: "App",
            exportPath: "src/api",
            version: "1.0",
            httpClient: "../https",
            excludedModules: [],
          },
        })
      );

      execFileSync(process.execPath, [cli, "--file", fixture], { cwd, encoding: "utf8" });

      const apiContent = fs.readFileSync(path.join(cwd, "src", "api", "user", "api.ts"), "utf8");
      assert.ok(
        apiContent.includes(expectedLine),
        `Expected api.ts for baseUrl=${baseUrl} to contain:\n${expectedLine}\nActual:\n${apiContent}`
      );
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test("missing local swagger file produces an error", () => {
  assert.throws(() =>
    execFileSync(process.execPath, [cli, "--file", "/nonexistent/swagger.json"], {
      encoding: "utf8",
      stdio: "pipe",
    })
  );
});
