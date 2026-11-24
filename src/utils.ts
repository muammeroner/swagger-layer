const VALID_IDENTIFIER_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
const PASCAL_IDENTIFIER_RE = /^[A-Z][a-zA-Z0-9_$]*$/;

const PRIMITIVE_TYPES = new Set([
  "string",
  "number",
  "boolean",
  "void",
  "unknown",
  "any",
  "never",
  "object",
  "Blob",
  "FormData",
]);

export function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^[a-z]/, (c: string) => c.toUpperCase());
}

export function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

export function cleanOperationId(opId: string): string {
  return opId.replace(/\d+$/, "");
}

export function resolveRef(ref: string): string {
  const parts = ref.split("/");
  return parts[parts.length - 1];
}

export function formatPropertyKey(key: string): string {
  return VALID_IDENTIFIER_RE.test(key) ? key : JSON.stringify(key);
}

export function isModuleExcluded(name: string, excludedModules: string[]): boolean {
  if (!name) return false;
  const normalize = (value: string): string =>
    toKebabCase(value).replace(/[-_]/g, "").toLowerCase();
  const target = normalize(name);
  return excludedModules.some((ex) => normalize(ex) === target);
}

export function cleanInterfaceImports(interfaces: Iterable<string>): string[] {
  return Array.from(new Set(interfaces))
    .filter((i) => !PRIMITIVE_TYPES.has(i) && PASCAL_IDENTIFIER_RE.test(i))
    .sort();
}
