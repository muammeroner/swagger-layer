import { schemaToTsType } from "../parser.js";
import type { OpenApiSchema, OperationResponseInfo } from "../types.js";
import { formatPropertyKey, GENERATED_HEADER, toEnumTypeName } from "../utils.js";

const BUILTIN_TYPES = `export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type PrimitiveQueryValue = string | number | boolean | null | undefined;
export type QueryParamValue = PrimitiveQueryValue | PrimitiveQueryValue[];
export type QueryParamsRecord = Record<string, unknown>;

`;

const renderApiErrorResponse = (errorListType: string): string => `/**
 * Standard API Error payload structure.
 */
export interface ApiErrorResponse {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  success?: boolean;
  statusCode?: number;
  result?: string;
  correlationId?: string;
  errorList?: ${errorListType};
}

`;

const REQUEST_TYPES = `/**
 * Per-request configuration compatible with the MDN Fetch API and React AbortController.
 */
export interface RequestConfig {
  baseUrl?: string;
  query?: object;
  defaultHeaders?: Record<string, string>;
  headers?: Record<string, string>;
  /** AbortSignal for cancelling in-flight requests inside React useEffect cleanup */
  signal?: AbortSignal;
  credentials?: RequestCredentials;
  cache?: RequestCache;
  mode?: RequestMode;
}

export interface HttpRequestArgs<TBody = unknown> {
  path: string;
  pathParams?: Record<string, string | number>;
  body?: TBody;
  options?: RequestConfig;
}

`;

const BUILTIN_INTERFACE_NAMES = ["ApiErrorResponse", "RequestConfig", "HttpRequestArgs"];

function renderInterface(
  name: string,
  schema: OpenApiSchema | undefined,
  enums: Set<string>,
  allSchemas: Record<string, OpenApiSchema>,
  description?: string
): string {
  const doc = description ? `/** ${description} */\n` : "";
  const requiredSet = new Set(schema?.required || []);
  const props = Object.entries(schema?.properties || {})
    .map(([propName, propSchema]) => {
      const optionalFlag = requiredSet.has(propName) ? "" : "?";
      const tsType = schemaToTsType(propSchema, enums, allSchemas);
      return `  ${formatPropertyKey(propName)}${optionalFlag}: ${tsType};\n`;
    })
    .join("");
  return `${doc}export interface ${name} {\n${props}}\n\n`;
}

export function generateTypes(
  schemas: Record<string, OpenApiSchema>,
  enums: Set<string>,
  opResponses: Map<string, OperationResponseInfo>
): string {
  const sortedEnumNames = Array.from(enums).map(toEnumTypeName).sort();
  const errorListType = schemas.ErrorList
    ? "ErrorList[]"
    : "Array<{ message?: string; code?: string; field?: string }>";

  let code = GENERATED_HEADER;
  if (sortedEnumNames.length > 0) {
    code += `import type { ${sortedEnumNames.join(", ")} } from "./enums";\n`;
  }
  code += `\n`;
  code += BUILTIN_TYPES;
  code += renderApiErrorResponse(errorListType);
  code += REQUEST_TYPES;

  const generatedInterfaceNames = new Set<string>(BUILTIN_INTERFACE_NAMES);

  // 1. OpenAPI schema interfaces
  const schemaNames = Object.keys(schemas)
    .filter((name) => !schemas[name].enum)
    .sort();
  for (const name of schemaNames) {
    generatedInterfaceNames.add(name);
    code += renderInterface(name, schemas[name], enums, schemas, schemas[name].description);
  }

  // 2. Inline operation response interfaces
  for (const [respName, { schema, refName }] of opResponses) {
    if (generatedInterfaceNames.has(respName)) continue;
    generatedInterfaceNames.add(respName);
    const targetSchema = refName && schemas[refName] ? schemas[refName] : schema;
    code += renderInterface(respName, targetSchema, enums, schemas);
  }

  return code.trimEnd() + "\n";
}
