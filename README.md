# Swagger Layer

[![npm version](https://img.shields.io/npm/v/swagger-layer.svg)](https://www.npmjs.com/package/swagger-layer)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6.svg)](https://www.typescriptlang.org/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#)

**`swagger-layer`** is a zero-dependency CLI tool that reads OpenAPI 3.x and Swagger 2.0 (`swagger.json`) specifications and generates a clean, end-to-end type-safe **API**, **Repository**, and **Service** architecture for **React** and **TypeScript** projects — complete with **Types** and **Enums**.

---

## Table of Contents

1. [Key Features](#key-features)
2. [Quick Start (3 Steps)](#quick-start-3-steps)
3. [Configuration (`config.json`)](#configuration-configjson)
4. [CLI Commands & Flags](#cli-commands--flags)
5. [Generated Architecture](#generated-architecture)
6. [React Usage Guide](#react-usage-guide)
   - [1. Fetching Data (`GET`)](#1-fetching-data-get)
   - [2. Mutating Data (`POST` / `PUT` / `DELETE`)](#2-mutating-data-post--put--delete)
   - [3. Using Layers Directly (`Service`, `Repository`, `API`)](#3-using-layers-directly-service-repository-api)
7. [Programmatic Usage (Node.js API)](#programmatic-usage-nodejs-api)
8. [License](#license)

---

## Key Features

- **Bring Your Own HTTP Client:** Does not generate or lock you into a bundled HTTP client. Configure `"httpClient"` (e.g. `"../https.ts"` or `"@/lib/https"`) inside the `"swaggerLayer"` object in `config.json`, and all generated `api.ts` files will import `get`, `post`, `put`, `patch`, and `del` directly from your path.
- **Layered Architecture:** Groups endpoints by OpenAPI tag into dedicated module directories with clear separation of concerns: `api.ts` $\rightarrow$ `repository.ts` $\rightarrow$ `service.ts`.
- **Unified Type Safety:**
  - `enums.ts`: All OpenAPI enum schemas generated as TypeScript enums (`EUserRole`, etc.) — numbered from `1` by default, or keeping their wire values / as union types via [`enumStyle`](#enum-styles-enumstyle).
  - `types.ts`: All DTO and response interfaces (`UserDto`, `CreateUserRequest`, etc.), `RequestConfig`, `HttpRequestArgs`, and `ApiErrorResponse` in a single file.
  - Inline query parameter types directly on method signatures (`query?: { page?: number; role?: "Admin" | "Member" | "Guest" }`).
- **OpenAPI 3.x & Swagger 2.0 Support:** Seamlessly parses both `components.schemas` / `requestBody` (OpenAPI 3) and `definitions` / `in: "body"` (Swagger 2).

---

## Quick Start (3 Steps)

### Step 1: Install the Package

Install `swagger-layer` as a development dependency in your React project:

```bash
npm install --save-dev swagger-layer
```

### Step 2: Initialize the Configuration File

Create a default `config.json` file with a `"swaggerLayer"` configuration block in your project root:

```bash
npx swagger-layer init
```

Customize the `"swaggerLayer"` object in `config.json` for your project:

```json
{
  "swaggerLayer": {
    "baseUrl": "https://api.example.com",
    "prefix": "App",
    "exportPath": "src/api",
    "version": "1.0",
    "input": "./swagger.json",
    "httpClient": "../https.ts",
    "excludedModules": []
  }
}
```

### Step 3: Generate Your API Layer

Add a script to your `package.json` and run it:

```json
{
  "scripts": {
    "generate:layer": "swagger-layer"
  }
}
```

```bash
npm run generate:layer
# or run directly via npx:
npx swagger-layer
```

Your complete type-safe API layer, types, enums, repositories, and services will be generated under `src/api/`.

---

## Configuration (`config.json`)

When `swagger-layer` runs, it reads the `"swaggerLayer"` object from `config.json` (or a custom file passed via `--config`).

### Configuration Options (`swaggerLayer`)

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **`baseUrl`** | `string` | `"https://api.example.com"` | Base server URL used for outgoing API requests. Wrap in `"${...}"` (e.g. `"${process.env.NEXT_PUBLIC_DEFAULT_API_URL}"`) to emit an unquoted expression in generated `api.ts` files. |
| **`prefix`** | `string` | `"App"` | Prefix added to generated `Repository` and `Service` class names (e.g. `"App"` $\rightarrow$ `AppUserService`, `AppUserRepository`). Can be empty (`""`). |
| **`exportPath`** | `string` | `"src/api"` | Target directory where all generated TypeScript files are written. |
| **`version`** | `string` | `"1.0"` | Default API version sent in the `api-version` HTTP header on every request. |
| **`input`** | `string` | `"./swagger.json"` | Local file path (`./swagger.json`) **or** remote URL (`https://.../swagger.json`) of the OpenAPI/Swagger JSON document. |
| **`httpClient`** | `string` | `"../https"` | Import path for your HTTP client module used inside generated `<module>/api.ts` files (e.g. `"../https.ts"`, `"../https"`, or `"@/lib/https"`). |
| **`excludedModules`** | `string[]` | `[]` | List of OpenAPI tags/modules to exclude from code generation (e.g. `["health", "internal"]`). |
| **`enumStyle`** | `"numeric"` \| `"string"` \| `"union"` | `"numeric"` | How enum schemas are emitted in `enums.ts`. See [Enum Styles](#enum-styles-enumstyle). |

### Enum Styles (`enumStyle`)

Given `"UserRole": { "type": "string", "enum": ["Admin", "Member"] }`:

| Style | Output | Use when |
| :--- | :--- | :--- |
| `numeric` (default) | `export enum EUserRole { Admin = 1, Member }` | Your backend sends enums as integers starting from `1`. |
| `string` | `export enum EUserRole { Admin = "Admin", Member = "Member" }` | Your backend sends enums as strings (e.g. .NET `JsonStringEnumConverter`). |
| `union` | `export type EUserRole = "Admin" \| "Member";` | You prefer plain literal types with no runtime code. |

Integer enums (`"type": "integer"`) always keep their real values (e.g. `Value0 = 0`). Member names are taken from `x-enumNames` (NSwag) or `x-enum-varnames` (openapi-generator) when present, so `{ "enum": [1, 5], "x-enumNames": ["Low", "High"] }` becomes `enum ELevel { Low = 1, High = 5 }`.

### Example: Generating from a Remote Swagger URL

```json
{
  "swaggerLayer": {
    "baseUrl": "https://api.example.com",
    "prefix": "App",
    "exportPath": "src/data",
    "version": "1.0",
    "input": "https://api.example.com/swagger/v1/swagger.json",
    "httpClient": "../https.ts",
    "excludedModules": ["identity", "account"]
  }
}
```

---

## CLI Commands & Flags

All configuration file options can be overridden via CLI flags:

```bash
# Create a default config.json file with "swaggerLayer" settings
npx swagger-layer init

# Generate from a local swagger.json file
npx swagger-layer --file ./docs/swagger.json

# Generate from a remote URL into a custom directory
npx swagger-layer --url https://api.example.com/swagger/v1/swagger.json --export-path src/api

# Override prefix, base URL, API version, and excluded modules via CLI
npx swagger-layer \
  --file ./swagger.json \
  --base-url https://api.example.com \
  --prefix Rg \
  --export-path src/api \
  --api-version 1.0 \
  --exclude health,metrics
```

| CLI Flag | Short | Description |
| :--- | :--- | :--- |
| `init` | - | Create or update `config.json` with a default `"swaggerLayer"` block |
| `--file <PATH>` | `-f` | Path to a local OpenAPI / Swagger JSON file |
| `--url <URL>` | `-u` | Remote OpenAPI / Swagger JSON URL |
| `--config <FILE>` | `-c` | Custom configuration file path |
| `--base-url <URL>` | - | Override `baseUrl` |
| `--prefix <PREFIX>` | `-p` | Override `Repository` and `Service` class prefix (`prefix`) |
| `--export-path <DIR>` | `-o` | Override target output directory (`exportPath`) |
| `--api-version <VER>` | - | Override default `api-version` header value |
| `--http-client <PATH>` | - | Specify a custom HTTP client import path |
| `--exclude <A,B>` | `-e` | Comma-separated list of modules/tags to exclude |
| `--enum-style <STYLE>` | - | Override `enumStyle` (`numeric`, `string`, or `union`) |
| `--help` | `-h` | Show help message |
| `--version` | `-v` | Show package version |

---

## Generated Architecture

Running with `exportPath: "src/api"` and `prefix: "App"` produces the following folder structure:

```text
src/api/
├── enums.ts            # All OpenAPI enum schemas (EUserRole, etc.), 1-based numeric enums
├── types.ts            # All DTO/response interfaces, RequestConfig, HttpRequestArgs & ApiErrorResponse
├── index.ts            # Root barrel file re-exporting types, enums, and modules
└── user/               # Module generated from the OpenAPI "User" tag
    ├── api.ts          # Low-level typed HTTP request functions importing from your `httpClient`
    ├── repository.ts   # AppUserRepository class
    ├── service.ts      # AppUserService class and ready-to-use `userService` singleton
    └── index.ts        # Module barrel exports
```

### Example Generated Files

```ts
// src/api/enums.ts
export enum EUserRole {
  Admin = 1,
  Member,
  Guest,
}

// src/api/types.ts
export interface UserDto {
  id: string;
  email: string;
  fullName?: string;
  role: EUserRole;
}

// src/api/user/service.ts
export class AppUserService {
  constructor(private readonly repository = new AppUserRepository()) {}

  getUsers(query?: { page?: number; role?: "Admin" | "Member" | "Guest" }): Promise<UserDto[]> {
    return this.repository.getUsers(query);
  }
  // ...
}
export const userService = new AppUserService();
```

---

## React Usage Guide

### 1. Fetching Data (`GET`)

Use the generated service singleton directly inside your React components or custom hooks:

```tsx
import { useEffect, useState } from "react";
import { userService, type UserDto } from "@/api";

export function UsersPage() {
  const [users, setUsers] = useState<UserDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    userService
      .getUsers({ page: 1, role: "Admin" })
      .then((res) => setUsers(res))
      .catch((err: unknown) => {
        if (err instanceof Error) {
          setError(err.message);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <ul>
      {users.map((user) => (
        <li key={user.id}>
          {user.fullName ?? user.email} — <strong>{user.role}</strong>
        </li>
      ))}
    </ul>
  );
}
```

### 2. Mutating Data (`POST` / `PUT` / `DELETE`)

Call service methods to create, update, or delete resources with full request and response type checking:

```tsx
import { useState } from "react";
import { userService, EUserRole } from "@/api";

export function CreateUserForm() {
  const [email, setEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    try {
      const created = await userService.createUser({
        email,
        role: EUserRole.Member,
      });
      alert(`User created: ${created.id}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "An unexpected error occurred.");
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email address"
        required
      />
      <button type="submit">Save</button>
      {errorMsg && <p style={{ color: "red" }}>{errorMsg}</p>}
    </form>
  );
}
```

### 3. Using Layers Directly (`Service`, `Repository`, `API`)

Pick whichever layer best fits your application architecture:

```ts
// 1. Pre-instantiated Service singleton (recommended for most React components)
import { userService } from "@/api/user";
const users = await userService.getUsers({ page: 1 });

// 2. Custom Service or Repository instance (ideal for unit testing / Dependency Injection)
import { AppUserService, AppUserRepository } from "@/api/user";
const customService = new AppUserService(new AppUserRepository());

// 3. Namespace import from the root index
import { user } from "@/api";
const singleUser = await user.getUserById("123");
```

---

## Programmatic Usage (Node.js API)

You can also invoke `swagger-layer` programmatically from your own Node.js build scripts:

```ts
import { generateApi } from "swagger-layer";

await generateApi({
  cwd: process.cwd(),
  config: {
    baseUrl: "https://api.example.com",
    prefix: "App",
    exportPath: "src/api",
    version: "1.0",
    input: "./swagger.json",
    excludedModules: ["internal"],
  },
});
```

---

## License

Licensed under the [MIT License](./LICENSE).
