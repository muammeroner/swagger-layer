import type { OpenApiSchema } from "../types.js";
import { formatPropertyKey, GENERATED_HEADER, getEnumSchemaNames, toEnumTypeName } from "../utils.js";

function renderEnum(name: string, schema: OpenApiSchema): string {
  const doc = schema.description ? `/** ${schema.description} */\n` : "";
  const members = (schema.enum || [])
    .map((value, i) => `  ${formatPropertyKey(String(value))}${i === 0 ? " = 1" : ""},\n`)
    .join("");
  return `${doc}export enum ${toEnumTypeName(name)} {\n${members}}\n`;
}

export function generateEnums(schemas: Record<string, OpenApiSchema>): string {
  const enumNames = getEnumSchemaNames(schemas);
  const header = `${GENERATED_HEADER}\n`;

  if (enumNames.length === 0) {
    return `${header}export {};\n`;
  }

  return header + enumNames.map((name) => renderEnum(name, schemas[name])).join("\n");
}
