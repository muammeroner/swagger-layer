import type { EnumStyle, OpenApiSchema } from "../types.js";
import {
  formatDocComment,
  formatEnumMemberName,
  formatLiteral,
  GENERATED_HEADER,
  getEnumSchemaNames,
  toEnumTypeName,
} from "../utils.js";

/**
 * Member names for an enum's values: taken from `x-enumNames` / `x-enum-varnames` when they
 * match the values one-to-one, otherwise derived from the values themselves. Duplicates get
 * a numeric suffix so every member is unique.
 */
function getMemberNames(schema: OpenApiSchema, values: (string | number)[]): string[] {
  const vendorNames = [schema["x-enumNames"], schema["x-enum-varnames"]].find(
    (names) =>
      Array.isArray(names) &&
      names.length === values.length &&
      names.every((n) => typeof n === "string" && n.length > 0)
  );
  const rawNames = vendorNames ?? values.map(String);

  const used = new Set<string>();
  return rawNames.map((raw) => {
    let name = formatEnumMemberName(raw);
    for (let i = 2; used.has(name); i++) {
      name = formatEnumMemberName(`${raw}_${i}`);
    }
    used.add(name);
    return name;
  });
}

/** `= <value>` initializer for each member, depending on the enum style. */
function getMemberInitializers(values: (string | number)[], style: EnumStyle): string[] {
  const allNumeric = values.every((v) => typeof v === "number");

  // Keep real values when they are numbers (wire format), or when the style asks for it
  if (style === "string" || allNumeric) {
    return values.map((v) => ` = ${formatLiteral(v)}`);
  }

  // Legacy "numeric" style for string values: number members from 1
  return values.map((_, i) => (i === 0 ? " = 1" : ""));
}

function renderEnum(name: string, schema: OpenApiSchema, style: EnumStyle): string {
  const typeName = toEnumTypeName(name);
  const values = schema.enum || [];
  const doc = formatDocComment(schema.description);

  if (style === "union") {
    const union = values.length > 0 ? values.map(formatLiteral).join(" | ") : "never";
    return `${doc}export type ${typeName} = ${union};\n`;
  }

  const names = getMemberNames(schema, values);
  const initializers = getMemberInitializers(values, style);
  const members = names.map((member, i) => `  ${member}${initializers[i]},\n`).join("");
  return `${doc}export enum ${typeName} {\n${members}}\n`;
}

export function generateEnums(
  schemas: Record<string, OpenApiSchema>,
  style: EnumStyle = "numeric"
): string {
  const enumNames = getEnumSchemaNames(schemas);
  const header = `${GENERATED_HEADER}\n`;

  if (enumNames.length === 0) {
    return `${header}export {};\n`;
  }

  return header + enumNames.map((name) => renderEnum(name, schemas[name], style)).join("\n");
}
