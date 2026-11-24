import * as fs from "node:fs";
import type {
  OpenApiDocument,
  OpenApiOperation,
  OpenApiParameter,
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
  resolveRef,
  toCamelCase,
  toKebabCase,
  toPascalCase,
} from "./utils.js";

const SUPPORTED_HTTP_VERBS = new Set(["get", "post", "put", "delete", "patch"]);
const SUCCESS_STATUS_CODES = ["200", "201", "202", "204"] as const;

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

export function schemaToTsType(
  schema: OpenApiSchema | undefined,
  enums: Set<string>,
  allSchemas: Record<string, OpenApiSchema>,
  forQuery = false
): string {
  if (!schema) return "unknown";

  if (schema.$ref) {
    const name = resolveRef(schema.$ref);
    if (enums.has(name)) {
      if (forQuery && Array.isArray(allSchemas[name]?.enum)) {
        return formatEnumUnion(allSchemas[name].enum!);
      }
      return `E${name}`;
    }
    return name;
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return schema.allOf.map((s) => schemaToTsType(s, enums, allSchemas, forQuery)).join(" & ");
  }

  const unionList = schema.oneOf || schema.anyOf;
  if (Array.isArray(unionList) && unionList.length > 0) {
    return unionList.map((s) => schemaToTsType(s, enums, allSchemas, forQuery)).join(" | ");
  }

  if (schema.enum && schema.enum.length > 0) {
    return formatEnumUnion(schema.enum);
  }

  if (schema.type === "string") {
    return schema.format === "binary" ? "Blob" : "string";
  }
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.type === "boolean") return "boolean";

  if (schema.type === "array") {
    const itemType = schemaToTsType(schema.items, enums, allSchemas, forQuery);
    return itemType.includes(" ") || itemType.includes("|") || itemType.includes("&")
      ? `(${itemType})[]`
      : `${itemType}[]`;
  }

  if (schema.type === "object" || schema.properties || schema.additionalProperties) {
    if (schema.properties && Object.keys(schema.properties).length > 0) {
      const reqSet = new Set(schema.required || []);
      const props = Object.entries(schema.properties).map(([k, v]) => {
        const opt = reqSet.has(k) ? "" : "?";
        return `${formatPropertyKey(k)}${opt}: ${schemaToTsType(v, enums, allSchemas, forQuery)}`;
      });
      return `{ ${props.join("; ")} }`;
    }
    if (typeof schema.additionalProperties === "object") {
      const valType = schemaToTsType(schema.additionalProperties, enums, allSchemas, forQuery);
      return `Record<string, ${valType}>`;
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
  if (schema.items) collectSchemaRefs(schema.items, enums, target);
  if (schema.properties) {
    for (const prop of Object.values(schema.properties)) {
      collectSchemaRefs(prop, enums, target);
    }
  }
  if (typeof schema.additionalProperties === "object") {
    collectSchemaRefs(schema.additionalProperties, enums, target);
  }
  for (const list of [schema.allOf, schema.oneOf, schema.anyOf]) {
    if (Array.isArray(list)) {
      list.forEach((s) => collectSchemaRefs(s, enums, target));
    }
  }
}

function parsePathParams(params: OpenApiParameter[]): PathParamField[] {
  const pathParams: PathParamField[] = [];
  const seen = new Set<string>();

  for (const p of params) {
    if (p.in !== "path" || seen.has(p.name)) continue;
    seen.add(p.name);
    const paramType = p.schema?.type ?? p.type;
    pathParams.push({
      name: toCamelCase(p.name),
      rawName: p.name,
      type: paramType === "integer" || paramType === "number" ? "number" : "string",
    });
  }

  return pathParams;
}

function parseQueryParams(
  params: OpenApiParameter[],
  enums: Set<string>,
  allSchemas: Record<string, OpenApiSchema>,
  usedInterfaces: Set<string>
): QueryParamField[] {
  const queryParams: QueryParamField[] = [];
  const seen = new Set<string>();

  for (const q of params) {
    if (q.in !== "query" || q.name === "api-version" || seen.has(q.name)) continue;
    seen.add(q.name);
    const qSchema = q.schema || { type: q.type, enum: q.enum, items: q.items };
    queryParams.push({
      name: toCamelCase(q.name),
      rawName: q.name,
      type: schemaToTsType(qSchema, enums, allSchemas, true),
      required: q.required,
    });
    collectSchemaRefs(qSchema, enums, usedInterfaces);
  }

  return queryParams;
}

function parseRequestBody(
  op: OpenApiOperation,
  params: OpenApiParameter[],
  enums: Set<string>,
  allSchemas: Record<string, OpenApiSchema>,
  usedInterfaces: Set<string>
): { bodyType?: string; isBodyRequired: boolean } {
  let isBodyRequired = Boolean(op.requestBody?.required);
  const content = op.requestBody?.content || {};
  const bodyMedia =
    content["application/json"] ||
    content["multipart/form-data"] ||
    content["application/x-www-form-urlencoded"] ||
    Object.values(content)[0];
  let reqBodySchema = bodyMedia?.schema;

  if (!reqBodySchema) {
    const swagger2BodyParam = params.find((p) => p.in === "body");
    if (swagger2BodyParam?.schema) {
      reqBodySchema = swagger2BodyParam.schema;
      isBodyRequired = Boolean(swagger2BodyParam.required);
    }
  }

  if (!reqBodySchema) {
    return { bodyType: undefined, isBodyRequired };
  }

  collectSchemaRefs(reqBodySchema, enums, usedInterfaces);

  let bodyType: string;
  if (reqBodySchema.$ref) {
    const refName = resolveRef(reqBodySchema.$ref);
    bodyType = enums.has(refName) ? `E${refName}` : refName;
  } else {
    bodyType = schemaToTsType(reqBodySchema, enums, allSchemas);
    if (bodyType === "unknown") {
      bodyType = "string";
    }
  }

  return { bodyType, isBodyRequired };
}

function parseResponseType(
  op: OpenApiOperation,
  httpVerb: string,
  cleanOp: string,
  enums: Set<string>,
  allSchemas: Record<string, OpenApiSchema>,
  usedInterfaces: Set<string>,
  opResponses: Map<string, OperationResponseInfo>
): string {
  const resps = op.responses || {};
  let successSchema: OpenApiSchema | undefined;

  for (const code of SUCCESS_STATUS_CODES) {
    const respObj = resps[code];
    if (!respObj) continue;
    if (respObj.content) {
      const media = respObj.content["application/json"] || Object.values(respObj.content)[0];
      if (media?.schema) {
        successSchema = media.schema;
        break;
      }
    } else if (respObj.schema) {
      successSchema = respObj.schema;
      break;
    }
  }

  if (!successSchema) {
    return httpVerb === "post" ? "string" : "void";
  }

  if (successSchema.type === "array") {
    if (successSchema.items?.$ref) {
      const itemRef = resolveRef(successSchema.items.$ref);
      if (!enums.has(itemRef)) usedInterfaces.add(itemRef);
      return enums.has(itemRef) ? `E${itemRef}[]` : `${itemRef}[]`;
    }
    return `${schemaToTsType(successSchema.items, enums, allSchemas)}[]`;
  }

  if (successSchema.type === "string") return "string";
  if (successSchema.type === "boolean") return "boolean";
  if (successSchema.type === "integer" || successSchema.type === "number") return "number";

  if (successSchema.$ref) {
    const refName = resolveRef(successSchema.$ref);
    if (allSchemas[refName] && !allSchemas[refName].enum) {
      usedInterfaces.add(refName);
      return refName;
    }
    const respName = `${cleanOp}Response`;
    usedInterfaces.add(respName);
    opResponses.set(respName, { schema: successSchema, refName });
    return respName;
  }

  const respName = `${cleanOp}Response`;
  usedInterfaces.add(respName);
  opResponses.set(respName, { schema: successSchema });
  return respName;
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
      const fnName = toCamelCase(cleanOp);
      const httpMethod: ParsedMethod["httpMethod"] =
        httpVerb === "delete" ? "del" : (httpVerb as "get" | "post" | "put" | "patch");

      const combinedParams: OpenApiParameter[] = [...pathLevelParams, ...(op.parameters || [])];
      const usedInterfaces = new Set<string>();
      const usedTypes = new Set<string>(["ApiErrorResponse"]);

      const pathParams = parsePathParams(combinedParams);
      const queryParamFields = parseQueryParams(combinedParams, enums, allSchemas, usedInterfaces);
      const { bodyType, isBodyRequired } = parseRequestBody(
        op,
        combinedParams,
        enums,
        allSchemas,
        usedInterfaces
      );
      const returnType = parseResponseType(
        op,
        httpVerb,
        cleanOp,
        enums,
        allSchemas,
        usedInterfaces,
        opResponses
      );

      if (!modules.has(moduleSlug)) {
        modules.set(moduleSlug, { tag: rawTag, moduleSlug, methods: [] });
      }

      modules.get(moduleSlug)!.methods.push({
        fnName,
        summary: op.summary || op.description,
        httpMethod,
        path: pathKey,
        pathParams,
        bodyType,
        isBodyRequired,
        queryParamFields,
        returnType,
        usedInterfaces,
        usedTypes,
      });
    }
  }

  return { modules, opResponses };
}
