/**
 * Minimal Zod -> JSON Schema converter scoped to the constructs our tool
 * inputs actually use: object / string / number / boolean / array / enum /
 * union / optional / default / refine. We deliberately keep this tiny to avoid
 * pulling in an external transitive dep and to stay in lockstep with the MCP
 * tool inputSchema shape ({ type: 'object', properties, required }).
 */

import { z } from 'zod';

export interface JsonSchemaObject {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
}

interface AnyJsonSchema {
  [k: string]: unknown;
}

function unwrap(schema: z.ZodTypeAny): {
  schema: z.ZodTypeAny;
  optional: boolean;
  hasDefault: boolean;
  defaultValue?: unknown;
} {
  let cur: z.ZodTypeAny = schema;
  let optional = false;
  let hasDefault = false;
  let defaultValue: unknown;

  // Strip wrapping containers we ignore for JSON Schema generation.
  // ZodEffects (refine/transform) and ZodOptional/ZodDefault are common.
  // We loop because these can nest.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (let i = 0; i < 10; i += 1) {
    const def = (cur as unknown as { _def?: { typeName?: string; innerType?: z.ZodTypeAny; defaultValue?: () => unknown; schema?: z.ZodTypeAny } })._def;
    if (!def) break;
    if (def.typeName === 'ZodOptional' && def.innerType) {
      optional = true;
      cur = def.innerType;
      continue;
    }
    if (def.typeName === 'ZodNullable' && def.innerType) {
      cur = def.innerType;
      continue;
    }
    if (def.typeName === 'ZodDefault' && def.innerType) {
      hasDefault = true;
      defaultValue = def.defaultValue ? def.defaultValue() : undefined;
      cur = def.innerType;
      continue;
    }
    if (def.typeName === 'ZodEffects' && def.schema) {
      cur = def.schema;
      continue;
    }
    break;
  }
  return { schema: cur, optional, hasDefault, defaultValue };
}

function convertInner(schema: z.ZodTypeAny): AnyJsonSchema {
  const def = (schema as unknown as { _def: { typeName: string; [k: string]: unknown } })._def;
  switch (def.typeName) {
    case 'ZodString': {
      const out: AnyJsonSchema = { type: 'string' };
      const checks = (def['checks'] as Array<{ kind: string; value?: number }> | undefined) ?? [];
      for (const c of checks) {
        if (c.kind === 'min' && typeof c.value === 'number') out['minLength'] = c.value;
        if (c.kind === 'max' && typeof c.value === 'number') out['maxLength'] = c.value;
        if (c.kind === 'length' && typeof c.value === 'number') {
          out['minLength'] = c.value;
          out['maxLength'] = c.value;
        }
        if (c.kind === 'uuid') out['format'] = 'uuid';
        if (c.kind === 'url') out['format'] = 'uri';
      }
      return out;
    }
    case 'ZodNumber': {
      const out: AnyJsonSchema = { type: 'number' };
      const checks = (def['checks'] as Array<{ kind: string; value?: number; inclusive?: boolean }> | undefined) ?? [];
      let isInt = false;
      for (const c of checks) {
        if (c.kind === 'int') isInt = true;
        if (c.kind === 'min' && typeof c.value === 'number') out['minimum'] = c.value;
        if (c.kind === 'max' && typeof c.value === 'number') out['maximum'] = c.value;
      }
      if (isInt) out['type'] = 'integer';
      return out;
    }
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodLiteral':
      return { const: def['value'] };
    case 'ZodEnum':
      return { type: 'string', enum: def['values'] as string[] };
    case 'ZodArray': {
      const inner = def['type'] as z.ZodTypeAny;
      return { type: 'array', items: convert(inner) };
    }
    case 'ZodUnion': {
      const opts = def['options'] as z.ZodTypeAny[];
      return { anyOf: opts.map((o) => convert(o)) };
    }
    case 'ZodObject':
      return zodObjectToJsonSchema(schema as z.ZodObject<z.ZodRawShape>);
    case 'ZodAny':
    case 'ZodUnknown':
      return {};
    default:
      return {};
  }
}

function convert(schema: z.ZodTypeAny): AnyJsonSchema {
  const { schema: inner, hasDefault, defaultValue } = unwrap(schema);
  const out = convertInner(inner);
  if (hasDefault) out['default'] = defaultValue;
  return out;
}

export function zodObjectToJsonSchema(schema: z.ZodObject<z.ZodRawShape>): JsonSchemaObject {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    const sub = value as z.ZodTypeAny;
    properties[key] = convert(sub);
    const { optional, hasDefault } = unwrap(sub);
    if (!optional && !hasDefault) required.push(key);
  }
  const out: JsonSchemaObject = {
    type: 'object',
    properties,
    additionalProperties: false,
  };
  if (required.length > 0) out.required = required;
  return out;
}

/**
 * Top-level entry: convert any Zod schema (typically a ZodObject or
 * ZodEffects-wrapped ZodObject) into the MCP tool inputSchema shape.
 */
export function toToolInputSchema(schema: z.ZodTypeAny): JsonSchemaObject {
  const { schema: inner } = unwrap(schema);
  if (inner instanceof z.ZodObject) {
    return zodObjectToJsonSchema(inner);
  }
  // Fallback: wrap non-object inputs in an empty object schema.
  return { type: 'object', properties: {}, additionalProperties: false };
}
