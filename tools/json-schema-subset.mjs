export function validateJsonSchemaSubset(schema, value, options = {}) {
  const errors = [];
  validateNode({
    schema,
    value,
    path: options.path ?? "$",
    rootSchema: schema,
    errors
  });
  return errors;
}

function validateNode(input) {
  const schema = resolveSchema(input.schema, input.rootSchema);
  if (!schema || typeof schema !== "object") {
    return;
  }

  validateConst(schema, input);
  validateEnum(schema, input);
  validateType(schema, input);
  validateAnyOf(schema, input);
  validateString(schema, input);
  validateNumber(schema, input);
  validateObject(schema, input);
  validateArray(schema, input);
}

function validateConst(schema, input) {
  if ("const" in schema && input.value !== schema.const) {
    input.errors.push(`${input.path} must be ${JSON.stringify(schema.const)}`);
  }
}

function validateEnum(schema, input) {
  if (Array.isArray(schema.enum) && !schema.enum.includes(input.value)) {
    input.errors.push(`${input.path} must be one of ${schema.enum.join(", ")}`);
  }
}

function validateType(schema, input) {
  if (!schema.type) {
    return;
  }
  const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!allowed.some((type) => matchesType(input.value, type))) {
    input.errors.push(`${input.path} must be ${allowed.join(" or ")}`);
  }
}

function validateAnyOf(schema, input) {
  if (!Array.isArray(schema.anyOf)) {
    return;
  }
  const anyMatched = schema.anyOf.some((candidate) => {
    const errors = [];
    validateNode({
      schema: candidate,
      value: input.value,
      path: input.path,
      rootSchema: input.rootSchema,
      errors
    });
    return errors.length === 0;
  });
  if (!anyMatched) {
    input.errors.push(`${input.path} must match at least one anyOf schema`);
  }
}

function validateString(schema, input) {
  if (typeof input.value !== "string") {
    return;
  }
  if (typeof schema.minLength === "number" && input.value.length < schema.minLength) {
    input.errors.push(`${input.path} must have at least ${schema.minLength} characters`);
  }
  if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(input.value)) {
    input.errors.push(`${input.path} must match ${schema.pattern}`);
  }
}

function validateNumber(schema, input) {
  if (typeof input.value !== "number") {
    return;
  }
  if (schema.type === "integer" && !Number.isInteger(input.value)) {
    input.errors.push(`${input.path} must be integer`);
  }
  if (typeof schema.minimum === "number" && input.value < schema.minimum) {
    input.errors.push(`${input.path} must be >= ${schema.minimum}`);
  }
}

function validateObject(schema, input) {
  if (!isPlainObject(input.value)) {
    return;
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (!(key in input.value)) {
      input.errors.push(`${input.path}.${key} is required`);
    }
  }

  const properties = schema.properties ?? {};
  for (const [key, childSchema] of Object.entries(properties)) {
    if (key in input.value) {
      validateNode({
        schema: childSchema,
        value: input.value[key],
        path: `${input.path}.${key}`,
        rootSchema: input.rootSchema,
        errors: input.errors
      });
    }
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(input.value)) {
      if (!(key in properties)) {
        input.errors.push(`${input.path}.${key} is not allowed`);
      }
    }
  } else if (isPlainObject(schema.additionalProperties)) {
    for (const [key, childValue] of Object.entries(input.value)) {
      if (key in properties) {
        continue;
      }
      validateNode({
        schema: schema.additionalProperties,
        value: childValue,
        path: `${input.path}.${key}`,
        rootSchema: input.rootSchema,
        errors: input.errors
      });
    }
  }
}

function validateArray(schema, input) {
  if (!Array.isArray(input.value)) {
    return;
  }
  if (typeof schema.minItems === "number" && input.value.length < schema.minItems) {
    input.errors.push(`${input.path} must have at least ${schema.minItems} items`);
  }
  if (schema.items) {
    input.value.forEach((entry, index) => {
      validateNode({
        schema: schema.items,
        value: entry,
        path: `${input.path}[${index}]`,
        rootSchema: input.rootSchema,
        errors: input.errors
      });
    });
  }
}

function resolveSchema(schema, rootSchema) {
  if (schema?.$ref?.startsWith("#/$defs/")) {
    return rootSchema.$defs?.[schema.$ref.slice("#/$defs/".length)];
  }
  return schema;
}

function matchesType(value, type) {
  if (type === "array") {
    return Array.isArray(value);
  }
  if (type === "integer") {
    return Number.isInteger(value);
  }
  if (type === "null") {
    return value === null;
  }
  if (type === "object") {
    return isPlainObject(value);
  }
  return typeof value === type;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
