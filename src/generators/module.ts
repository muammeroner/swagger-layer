import type { ParsedMethod, SwaggerLayerConfig } from "../types.js";
import {
  cleanInterfaceImports,
  GENERATED_HEADER,
  toCamelCase,
  toEnumTypeName,
  toPascalCase,
} from "../utils.js";

const ERROR_RESPONSE_TYPE = "ApiErrorResponse";

function collectEnumImports(methods: ParsedMethod[], enums: Set<string>): string[] {
  const usedEnums = new Set<string>();
  for (const m of methods) {
    const typesInMethod = [m.bodyType ?? "", m.returnType, ...m.queryParamFields.map((q) => q.type)];
    for (const e of enums) {
      const enumType = toEnumTypeName(e);
      if (typesInMethod.some((t) => t.includes(enumType))) {
        usedEnums.add(enumType);
      }
    }
  }
  return Array.from(usedEnums).sort();
}

function collectModuleImports(
  methods: ParsedMethod[],
  enums: Set<string>,
  initialTypes: string[] = []
): { sortedEnums: string[]; sortedTypes: string[] } {
  const allInterfaces = new Set<string>();
  const allTypes = new Set<string>(initialTypes);
  const stripArray = (type: string): string => type.replace(/\[\]$/, "");

  for (const m of methods) {
    m.usedInterfaces.forEach((i) => allInterfaces.add(i));
    if (initialTypes.length > 0) {
      m.usedTypes.forEach((t) => allTypes.add(t));
    }
    if (m.bodyType) {
      allInterfaces.add(stripArray(m.bodyType));
    }
    allInterfaces.add(stripArray(m.returnType));
  }

  const sortedEnums = collectEnumImports(methods, enums);
  const enumSet = new Set(sortedEnums);
  const sortedInterfaces = cleanInterfaceImports(allInterfaces).filter(
    (i) => !allTypes.has(i) && !enumSet.has(i)
  );
  const sortedTypes = Array.from(new Set([...sortedInterfaces, ...allTypes])).sort();

  return { sortedEnums, sortedTypes };
}

function renderSharedTypeImports(sortedEnums: string[], sortedTypes: string[]): string {
  let imports = "";
  if (sortedEnums.length > 0) {
    imports += `import type { ${sortedEnums.join(", ")} } from "../enums";\n`;
  }
  if (sortedTypes.length > 0) {
    imports += `import type { ${sortedTypes.join(", ")} } from "../types";\n`;
  }
  return imports;
}

function buildMethodSignature(m: ParsedMethod): {
  paramsList: string[];
  argNames: string[];
} {
  const paramsList: string[] = [];
  const argNames: string[] = [];

  for (const p of m.pathParams) {
    paramsList.push(`${p.name}: ${p.type}`);
    argNames.push(p.name);
  }

  if (m.bodyType) {
    const optionalFlag = m.isBodyRequired ? "" : "?";
    paramsList.push(`body${optionalFlag}: ${m.bodyType}`);
    argNames.push("body");
  }

  if (m.queryParamFields.length > 0) {
    const fields = m.queryParamFields
      .map((f) => `${f.name}${f.required ? "" : "?"}: ${f.type}`)
      .join("; ");
    paramsList.push(`query?: { ${fields} }`);
    argNames.push("query");
  }

  return { paramsList, argNames };
}

/**
 * Returns the inner expression of a value wrapped as `${...}` (e.g. `${process.env.API_URL}`),
 * or `undefined` if the value is not a single, balanced raw expression.
 */
function extractRawExpression(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("${") || !trimmed.endsWith("}")) {
    return undefined;
  }

  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;

  for (let i = 1; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        if (i !== trimmed.length - 1) {
          return undefined;
        }
        const expr = trimmed.slice(2, -1).trim();
        return expr.length > 0 ? expr : undefined;
      }
    }
  }

  return undefined;
}

function formatBaseUrlValue(baseUrl: string): string {
  return extractRawExpression(baseUrl) ?? JSON.stringify(baseUrl);
}

function getClassNames(tag: string, config: SwaggerLayerConfig) {
  const pascalTag = toPascalCase(tag);
  return {
    repository: `${config.prefix}${pascalTag}Repository`,
    service: `${config.prefix}${pascalTag}Service`,
    serviceInstance: `${toCamelCase(pascalTag)}Service`,
  };
}

/** Renders a class method that forwards all of its arguments to `target.<fnName>`. */
function renderDelegatingMethod(m: ParsedMethod, target: string): string {
  const { paramsList, argNames } = buildMethodSignature(m);
  return (
    `  ${m.fnName}(${paramsList.join(", ")}): Promise<${m.returnType}> {\n` +
    `    return ${target}.${m.fnName}(${argNames.join(", ")});\n` +
    `  }\n`
  );
}

function renderApiFunction(m: ParsedMethod): string {
  const { paramsList } = buildMethodSignature(m);
  const pathParamsObj =
    m.pathParams.length > 0
      ? `{ ${m.pathParams.map((p) => `${JSON.stringify(p.rawName)}: ${p.name}`).join(", ")} }`
      : "undefined";

  let code = m.summary ? `/** ${m.summary} */\n` : "";
  code += `export async function ${m.fnName}(${paramsList.join(", ")}): Promise<${m.returnType}> {\n`;
  code += `  return ${m.httpMethod}<${m.returnType}, ${ERROR_RESPONSE_TYPE}>({\n`;
  code += `    path: ${JSON.stringify(m.path)},\n`;
  code += `    pathParams: ${pathParamsObj},\n`;
  code += `    body: ${m.bodyType ? "body" : "undefined"},\n`;
  code += `    options: {\n`;
  code += `      baseUrl: DEFAULT_API_URL,\n`;
  if (m.queryParamFields.length > 0) {
    code += `      query,\n`;
  }
  code += `      defaultHeaders: { "Content-Type": "application/json" },\n`;
  code += `      headers: { "api-version": DEFAULT_API_VERSION },\n`;
  code += `    },\n`;
  code += `  });\n`;
  code += `}\n`;
  return code;
}

export function generateModuleApi(
  methods: ParsedMethod[],
  enums: Set<string>,
  config: SwaggerLayerConfig
): string {
  const httpMethodsUsed = Array.from(new Set(methods.map((m) => m.httpMethod))).sort();
  const { sortedEnums, sortedTypes } = collectModuleImports(methods, enums, [ERROR_RESPONSE_TYPE]);
  const httpImportPath = config.httpClient || "../https";

  let code = GENERATED_HEADER;
  code += renderSharedTypeImports(sortedEnums, sortedTypes);
  code += `import { ${httpMethodsUsed.join(", ")} } from ${JSON.stringify(httpImportPath)};\n\n`;
  code += `const DEFAULT_API_URL = ${formatBaseUrlValue(config.baseUrl)};\n`;
  code += `const DEFAULT_API_VERSION = ${JSON.stringify(config.version)};\n\n`;
  code += methods.map(renderApiFunction).join("\n");

  return code.trimEnd() + "\n";
}

export function generateModuleRepository(
  tag: string,
  methods: ParsedMethod[],
  enums: Set<string>,
  config: SwaggerLayerConfig
): string {
  const { repository } = getClassNames(tag, config);
  const { sortedEnums, sortedTypes } = collectModuleImports(methods, enums);

  let code = GENERATED_HEADER;
  code += `import * as api from "./api";\n`;
  code += renderSharedTypeImports(sortedEnums, sortedTypes);
  code += `\nexport class ${repository} {\n`;
  code += methods.map((m) => renderDelegatingMethod(m, "api")).join("");
  code += `}\n`;
  return code;
}

export function generateModuleService(
  tag: string,
  methods: ParsedMethod[],
  enums: Set<string>,
  config: SwaggerLayerConfig
): string {
  const { repository, service, serviceInstance } = getClassNames(tag, config);
  const { sortedEnums, sortedTypes } = collectModuleImports(methods, enums);

  let code = GENERATED_HEADER;
  code += `import { ${repository} } from "./repository";\n`;
  code += renderSharedTypeImports(sortedEnums, sortedTypes);
  code += `\nexport class ${service} {\n`;
  code += `  constructor(private readonly repository = new ${repository}()) {}\n\n`;
  code += methods.map((m) => renderDelegatingMethod(m, "this.repository")).join("\n");
  code += `}\n\n`;
  code += `export const ${serviceInstance} = new ${service}();\n`;
  return code;
}

export function generateModuleIndex(): string {
  return `export * from "./api";\nexport * from "./repository";\nexport * from "./service";\n`;
}

export function generateRootIndex(moduleSlugs: string[]): string {
  let code = `export * from "./types";\nexport * from "./enums";\n`;
  for (const slug of [...moduleSlugs].sort()) {
    code += `export * as ${toCamelCase(slug)} from "./${slug}";\n`;
  }
  return code;
}
