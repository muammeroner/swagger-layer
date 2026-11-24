import * as fs from "node:fs";
import type {
  OpenApiDocument,
  OpenApiMediaType,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiResponse,
  OpenApiSchema,
  OperationResponseInfo,
  ParsedMethod,
  ParsedModule,
  PathParamField,
  QueryParamField,
} from "./types.js";
import {
  cleanOperationId,
  formatPropertyKey,
  isModuleExcluded,
  refToTypeName,
  resolveRef,
  toCamelCase,
  toEnumTypeName,
  toKebabCase,
  toPascalCase,
} from "./utils.js";

const SUPPORTED_HTTP_VERBS = new Set(["get", "post", "put", "delete", "patch"]);
const SUCCESS_STATUS_CODES = ["200", "201", "202", "204"] as const;
const REQUEST_BODY_MEDIA_TYPES = [
  "application/json",
  "multipart/form-data",
  "application/x-www-form-urlencoded",
];
const RESPONSE_MEDIA_TYPES = ["application/json"];

/** Shared state used while parsing a single operation. */
interface ParseContext {
  enums: Set<string>;
  allSchemas: Record<string, OpenApiSchema>;
  usedInterfaces: Set<string>;
}

export async function loadSwagger(
  swaggerUrl: string,
  file?: string
): Promise<{ doc: OpenApiDocument; sourceUrl: string }> {
  if (file) {
    if (!fs.existsSync(file)) {
      throw new Error(`Swagger file not found: ${file}`);
    }
    console.log(`[swagger-layer] Reading Swagger from file: ${file}`);
    const raw = fs.readFileSync(file, "utf-8");
    return { doc: JSON.parse(raw) as OpenApiDocument, sourceUrl: swaggerUrl || file };
  }

  console.log(`[swagger-layer] Fetching Swagger from ${swaggerUrl}...`);
  const res = await fetch(swaggerUrl);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch swagger from ${swaggerUrl} (HTTP ${res.status}: ${res.statusText})`
    );
  }

  const doc = (await res.json()) as OpenApiDocument;
  return { doc, sourceUrl: swaggerUrl };
}

export function extractSchemas(doc: OpenApiDocument): Record<string, OpenApiSchema> {
  return {
    ...(doc.definitions || {}),
    ...(doc.components?.schemas || {}),
  };
}

function formatEnumUnion(values: (string | number)[]): string {
  return values.map((v) => (typeof v === "string" ? `"${v}"` : String(v))).join(" | ");
}

/** Wraps compound types in parentheses so they can be suffixed with `[]`. */
function toArrayType(itemType: string): string {
  return /[ |&]/.test(itemType) ? `(${itemType})[]` : `${itemType}[]`;
}

export function schemaToTsType(
  schema: OpenApiSchema | undefined,
  enums: Set<string>,
  allSchemas: Record<string, OpenApiSchema>,
  forQuery = false
): string {
  if (!schema) return "unknown";

  const recurse = (s: OpenApiSchema | undefined): string =>
    schemaToTsType(s, enums, allSchemas, forQuery);

  if (schema.$ref) {
    const name = resolveRef(schema.$ref);
    if (!enums.has(name)) return name;
    const enumValues = allSchemas[name]?.enum;
    return forQuery && Array.isArray(enumValues)
      ? formatEnumUnion(enumValues)
      : toEnumTypeName(name);
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return schema.allOf.map(recurse).join(" & ");
  }

  const unionList = schema.oneOf || schema.anyOf;
  if (Array.isArray(unionList) && unionList.length > 0) {
    return unionList.map(recurse).join(" | ");
  }

  if (schema.enum && schema.enum.length > 0) {
    return formatEnumUnion(schema.enum);
  }

  switch (schema.type) {
    case "string":
      return schema.format === "binary" ? "Blob" : "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return toArrayType(recurse(schema.items));
  }

  if (schema.type === "object" || schema.properties || schema.additionalProperties) {
    if (schema.properties && Object.keys(schema.properties).length > 0) {
      const reqSet = new Set(schema.required || []);
      const props = Object.entries(schema.properties).map(([k, v]) => {
        const opt = reqSet.has(k) ? "" : "?";
        return `${formatPropertyKey(k)}${opt}: ${recurse(v)}`;
      });
      return `{ ${props.join("; ")} }`;
    }
    if (typeof schema.additionalProperties === "object") {
      return `Record<string, ${recurse(schema.additionalProperties)}>`;
    }
    return "Record<string, unknown>";
  }

  return "unknown";
}

function collectSchemaRefs(
  schema: OpenApiSchema | undefined,
  enums: Set<string>,
  target: Set<string>
): void {
  if (!schema) return;
  if (schema.$ref) {
    const refName = resolveRef(schema.$ref);
    if (!enums.has(refName)) target.add(refName);
  }

  const children: Array<OpenApiSchema | undefined> = [
    schema.items,
    ...Object.values(schema.properties || {}),
    typeof schema.additionalProperties === "object" ? schema.additionalProperties : undefined,
    ...(schema.allOf || []),
    ...(schema.oneOf || []),
    ...(schema.anyOf || []),
  ];
  for (const child of children) {
    collectSchemaRefs(child, enums, target);
  }
}

/** Picks the schema of the first preferred media type, falling back to the first entry. */
function pickMediaSchema(
  content: Record<string, OpenApiMediaType> | undefined,
  preferredTypes: string[]
): OpenApiSchema | undefined {
  if (!content) return undefined;
  const preferred = preferredTypes.map((t) => content[t]).find(Boolean);
  return (preferred || Object.values(content)[0])?.schema;
}

/** Iterates params of the given location, skipping duplicates by name. */
function uniqueParams(
  params: OpenApiParameter[],
  location: string,
  skip: (p: OpenApiParameter) => boolean = () => false
): OpenApiParameter[] {
  const seen = new Set<string>();
  return params.filter((p) => {
    if (p.in !== location || skip(p) || seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });
}

function parsePathParams(params: OpenApiParameter[]): PathParamField[] {
  return uniqueParams(params, "path").map((p) => {
    const paramType = p.schema?.type ?? p.type;
    return {
      name: toCamelCase(p.name),
      rawName: p.name,
      type: paramType === "integer" || paramType === "number" ? "number" : "string",
    };
  });
}

function parseQueryParams(params: OpenApiParameter[], ctx: ParseContext): QueryParamField[] {
  return uniqueParams(params, "query", (q) => q.name === "api-version").map((q) => {
    const qSchema = q.schema || { type: q.type, enum: q.enum, items: q.items };
    collectSchemaRefs(qSchema, ctx.enums, ctx.usedInterfaces);
    return {
      name: toCamelCase(q.name),
      rawName: q.name,
      type: schemaToTsType(qSchema, ctx.enums, ctx.allSchemas, true),
      required: q.required,
    };
  });
}

function parseRequestBody(
  op: OpenApiOperation,
  params: OpenApiParameter[],
  ctx: ParseContext
): { bodyType?: string; isBodyRequired: boolean } {
  let isBodyRequired = Boolean(op.requestBody?.required);
  let reqBodySchema = pickMediaSchema(op.requestBody?.content || {}, REQUEST_BODY_MEDIA_TYPES);

  if (!reqBodySchema) {
    // Swagger 2.0: body is declared as an `in: body` parameter
    const swagger2BodyParam = params.find((p) => p.in === "body");
    if (swagger2BodyParam?.schema) {
      reqBodySchema = swagger2BodyParam.schema;
      isBodyRequired = Boolean(swagger2BodyParam.required);
    }
  }

  if (!reqBodySchema) {
    return { bodyType: undefined, isBodyRequired };
  }

  collectSchemaRefs(reqBodySchema, ctx.enums, ctx.usedInterfaces);

  if (reqBodySchema.$ref) {
    return { bodyType: refToTypeName(resolveRef(reqBodySchema.$ref), ctx.enums), isBodyRequired };
  }

  const inlineType = schemaToTsType(reqBodySchema, ctx.enums, ctx.allSchemas);
  return { bodyType: inlineType === "unknown" ? "string" : inlineType, isBodyRequired };
}

function findSuccessSchema(
  responses: Record<string, OpenApiResponse>
): OpenApiSchema | undefined {
  for (const code of SUCCESS_STATUS_CODES) {
    const respObj = responses[code];
    if (!respObj) continue;
    const schema = respObj.content
      ? pickMediaSchema(respObj.content, RESPONSE_MEDIA_TYPES)
      : respObj.schema;
    if (schema) return schema;
  }
  return undefined;
}

function parseResponseType(
  op: OpenApiOperation,
  httpVerb: string,
  cleanOp: string,
  ctx: ParseContext,
  opResponses: Map<string, OperationResponseInfo>
): string {
  const { enums, allSchemas, usedInterfaces } = ctx;
  const successSchema = findSuccessSchema(op.responses || {});

  if (!successSchema) {
    return httpVerb === "post" ? "string" : "void";
  }

  switch (successSchema.type) {
    case "array": {
      if (successSchema.items?.$ref) {
        const itemRef = resolveRef(successSchema.items.$ref);
        if (!enums.has(itemRef)) usedInterfaces.add(itemRef);
        return `${refToTypeName(itemRef, enums)}[]`;
      }
      return `${schemaToTsType(successSchema.items, enums, allSchemas)}[]`;
    }
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "integer":
    case "number":
      return "number";
  }

  const refName = successSchema.$ref ? resolveRef(successSchema.$ref) : undefined;
  if (refName && allSchemas[refName] && !allSchemas[refName].enum) {
    usedInterfaces.add(refName);
    return refName;
  }

  // Inline (or unresolvable) response schema: emit a dedicated `<Operation>Response` interface
  const respName = `${cleanOp}Response`;
  usedInterfaces.add(respName);
  opResponses.set(respName, refName ? { schema: successSchema, refName } : { schema: successSchema });
  return respName;
}

function toHttpMethod(httpVerb: string): ParsedMethod["httpMethod"] {
  return httpVerb === "delete" ? "del" : (httpVerb as ParsedMethod["httpMethod"]);
}

export function parseOperations(
  doc: OpenApiDocument,
  enums: Set<string>,
  excludedModules: string[]
): {
  modules: Map<string, ParsedModule>;
  opResponses: Map<string, OperationResponseInfo>;
} {
  const modules = new Map<string, ParsedModule>();
  const opResponses = new Map<string, OperationResponseInfo>();
  const allSchemas = extractSchemas(doc);

  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    if (!pathItem) continue;

    const pathLevelParams: OpenApiParameter[] = Array.isArray(pathItem.parameters)
      ? (pathItem.parameters as OpenApiParameter[])
      : [];

    for (const [methodKey, rawOperation] of Object.entries(pathItem)) {
      const httpVerb = methodKey.toLowerCase();
      if (!SUPPORTED_HTTP_VERBS.has(httpVerb)) continue;

      const op = rawOperation as OpenApiOperation | undefined;
      if (!op) continue;

      const rawTag = op.tags?.[0] || "Default";
      const moduleSlug = toKebabCase(rawTag);

      if (
        isModuleExcluded(moduleSlug, excludedModules) ||
        isModuleExcluded(rawTag, excludedModules)
      ) {
        continue;
      }

      const opId = op.operationId || `${httpVerb}${toPascalCase(pathKey)}`;
      const cleanOp = toPascalCase(cleanOperationId(opId));
      const combinedParams: OpenApiParameter[] = [...pathLevelParams, ...(op.parameters || [])];
      const ctx: ParseContext = { enums, allSchemas, usedInterfaces: new Set<string>() };

      const pathParams = parsePathParams(combinedParams);
      const queryParamFields = parseQueryParams(combinedParams, ctx);
      const { bodyType, isBodyRequired } = parseRequestBody(op, combinedParams, ctx);
      const returnType = parseResponseType(op, httpVerb, cleanOp, ctx, opResponses);

      let module = modules.get(moduleSlug);
      if (!module) {
        module = { tag: rawTag, moduleSlug, methods: [] };
        modules.set(moduleSlug, module);
      }

      module.methods.push({
        fnName: toCamelCase(cleanOp),
        summary: op.summary || op.description,
        httpMethod: toHttpMethod(httpVerb),
        path: pathKey,
        pathParams,
        bodyType,
        isBodyRequired,
        queryParamFields,
        returnType,
        usedInterfaces: ctx.usedInterfaces,
        usedTypes: new Set<string>(["ApiErrorResponse"]),
      });
    }
  }

  return { modules, opResponses };
}
