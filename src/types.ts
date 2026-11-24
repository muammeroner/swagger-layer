export interface SwaggerLayerConfig {
  /** Base URL for API calls (e.g. "https://api.example.com" or "${process.env.NEXT_PUBLIC_DEFAULT_API_URL}") */
  baseUrl: string;
  /** Prefix for generated Repository and Service classes (e.g. "App", "Rg") */
  prefix: string;
  /** Target output directory in the project (e.g. "src/api", "lib/data") */
  exportPath: string;
  /** Default API version sent in headers (e.g. "1.0") */
  version: string;
  /** Optional path or URL to swagger.json */
  input?: string;
  /** Modules (OpenAPI tags) to exclude from code generation */
  excludedModules: string[];
  /**
   * HTTP client import path used in generated module `api.ts` files (e.g. "../https", "../https.ts", "@/lib/https").
   */
  httpClient: string;
  /** URL template when resolving by `--name` */
  swaggerUrlTemplate: string;
  /** Default subdomain/service name for `swaggerUrlTemplate` */
  defaultName: string;
}

export type SwaggerFlowConfig = SwaggerLayerConfig;
export type ReactSwaggenConfig = SwaggerLayerConfig;
export type SwaggeneConfig = SwaggerLayerConfig;

export type RawConfigFile = Partial<SwaggerLayerConfig> & {
  swaggerLayer?: Partial<SwaggerLayerConfig>;
  swaggerFlow?: Partial<SwaggerLayerConfig>;
};

export interface CliArgs {
  init?: boolean;
  help?: boolean;
  versionFlag?: boolean;
  name?: string;
  url?: string;
  file?: string;
  config?: string;
  baseUrl?: string;
  prefix?: string;
  exportPath?: string;
  apiVersion?: string;
  httpClient?: string;
  exclude?: string;
}

export interface GenerateOptions {
  cwd?: string;
  args?: CliArgs;
  config?: Partial<SwaggerLayerConfig>;
}

export interface OpenApiSchema {
  $ref?: string;
  type?: string;
  format?: string;
  nullable?: boolean;
  description?: string;
  enum?: (string | number)[];
  items?: OpenApiSchema;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  additionalProperties?: boolean | OpenApiSchema;
  allOf?: OpenApiSchema[];
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
}

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie" | "body" | "formData" | string;
  required?: boolean;
  description?: string;
  type?: string;
  schema?: OpenApiSchema;
  items?: OpenApiSchema;
  enum?: (string | number)[];
}

export interface OpenApiMediaType {
  schema?: OpenApiSchema;
}

export interface OpenApiRequestBody {
  required?: boolean;
  description?: string;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  description?: string;
  schema?: OpenApiSchema;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
}

export type OpenApiPathItem = Record<string, OpenApiOperation | OpenApiParameter[] | undefined>;

export interface OpenApiDocument {
  openapi?: string;
  swagger?: string;
  info?: {
    title?: string;
    version?: string;
    description?: string;
  };
  host?: string;
  basePath?: string;
  schemes?: string[];
  servers?: Array<{ url: string; description?: string }>;
  paths?: Record<string, OpenApiPathItem>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
    parameters?: Record<string, OpenApiParameter>;
  };
  definitions?: Record<string, OpenApiSchema>;
}

export interface PathParamField {
  name: string;
  rawName: string;
  type: string;
}

export interface QueryParamField {
  name: string;
  rawName: string;
  type: string;
  required?: boolean;
}

export interface ParsedMethod {
  fnName: string;
  summary?: string;
  httpMethod: "get" | "post" | "put" | "patch" | "del";
  path: string;
  pathParams: PathParamField[];
  bodyType?: string;
  isBodyRequired: boolean;
  queryParamFields: QueryParamField[];
  returnType: string;
  usedInterfaces: Set<string>;
  usedTypes: Set<string>;
}

export interface ParsedModule {
  tag: string;
  moduleSlug: string;
  methods: ParsedMethod[];
}

export interface OperationResponseInfo {
  schema: OpenApiSchema;
  refName?: string;
}
