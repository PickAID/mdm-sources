import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const DEFAULT_SYMBOLS_URL =
  "https://raw.githubusercontent.com/SpyglassMC/vanilla-mcdoc/generated/symbols.json";

export async function readVanillaMcdocSymbols(input, vanillaRoot) {
  if (input.vanillaMcdocSymbols) {
    return input.vanillaMcdocSymbols;
  }
  if (input.vanillaMcdocSymbolsPath) {
    return JSON.parse(await readFile(resolve(input.vanillaMcdocSymbolsPath), "utf-8"));
  }

  const localSymbols = await readOptionalJson(join(vanillaRoot, "generated", "symbols.json"));
  return localSymbols ?? fetchJson(input.vanillaMcdocSymbolsUrl ?? DEFAULT_SYMBOLS_URL);
}

export function buildSchemaSymbolSummary(vanillaSymbols, repoPath, sourceSymbols, config, limits) {
  if (!vanillaSymbols) {
    return undefined;
  }

  const modulePath = `::${repoPath.replace(/\.mcdoc$/u, "").replaceAll("/", "::")}`;
  const mcdoc = vanillaSymbols.mcdoc ?? {};
  const dispatchers = vanillaSymbols["mcdoc/dispatcher"] ?? {};
  const typePaths = sourceSymbols
    .map((symbol) => `${modulePath}::${symbol}`)
    .filter((path) => mcdoc[path])
    .slice(0, limits.maxTypePaths);
  const dispatcherMatches = matchingDispatchers(dispatchers, modulePath, config, limits)
    .slice(0, limits.maxDispatchers);

  if (typePaths.length === 0 && dispatcherMatches.length === 0) {
    return undefined;
  }

  return {
    source: "vanilla-mcdoc-generated-symbols",
    ref: vanillaSymbols.ref,
    modulePath,
    typePaths,
    dispatchers: dispatcherMatches,
    sampleTypes: Object.fromEntries(
      typePaths
        .slice(0, limits.maxSampleTypes)
        .map((path) => [path, compactTypeDef(mcdoc[path], limits)])
    )
  };
}

async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function matchingDispatchers(dispatchers, modulePath, config, limits) {
  const matches = [];
  for (const [name, entries] of Object.entries(dispatchers)) {
    for (const [key, typeDef] of Object.entries(entries ?? {})) {
      const referencedPath = referencedTypePath(typeDef);
      if (referencedPath?.startsWith(modulePath)) {
        matches.push({
          name,
          key,
          type: compactDispatcherType(typeDef, limits),
          domain: config.domain
        });
      }
    }
  }
  return matches;
}

function referencedTypePath(typeDef) {
  if (!typeDef || typeof typeDef !== "object") {
    return undefined;
  }
  if (typeof typeDef.path === "string") {
    return typeDef.path;
  }
  return referencedTypePath(typeDef.child);
}

function compactTypeDef(typeDef, limits, depth = 0) {
  if (!typeDef || typeof typeDef !== "object") {
    return typeDef;
  }
  if (depth >= 4) {
    return { kind: typeDef.kind };
  }

  const base = {
    kind: typeDef.kind,
    attributes: compactAttributes(typeDef.attributes, limits)
  };
  if (typeof typeDef.path === "string") {
    return optionalObject({ ...base, path: typeDef.path });
  }
  if (Object.hasOwn(typeDef, "value")) {
    return optionalObject({ ...base, value: compactLiteral(typeDef.value) });
  }
  if (Array.isArray(typeDef.fields)) {
    return optionalObject({
      ...base,
      fields: typeDef.fields
        .slice(0, limits.maxFieldsPerDefinition)
        .map((field) => compactField(field, limits, depth + 1))
    });
  }
  if (Array.isArray(typeDef.members)) {
    return optionalObject({
      ...base,
      members: typeDef.members
        .slice(0, limits.maxUnionMembers)
        .map((member) => compactTypeDef(member, limits, depth + 1))
    });
  }
  if (typeDef.child) {
    return optionalObject({
      ...base,
      child: compactTypeDef(typeDef.child, limits, depth + 1),
      typeArgs: Array.isArray(typeDef.typeArgs)
        ? typeDef.typeArgs.slice(0, 4).map((item) => compactTypeDef(item, limits, depth + 1))
        : undefined
    });
  }

  return optionalObject(base);
}

function compactDispatcherType(typeDef, limits) {
  if (!typeDef || typeof typeDef !== "object") {
    return undefined;
  }
  return optionalObject({
    kind: typeDef.kind,
    path: referencedTypePath(typeDef),
    attributes: compactAttributes(typeDef.attributes, limits)
  });
}

function compactField(field, limits, depth) {
  return optionalObject({
    kind: field.kind,
    key: compactFieldKey(field.key, limits),
    optional: field.optional,
    attributes: compactAttributes(field.attributes, limits),
    type: compactTypeDef(field.type, limits, depth)
  });
}

function compactFieldKey(key, limits) {
  if (typeof key === "string") {
    return key;
  }
  if (!key || typeof key !== "object") {
    return undefined;
  }
  if (key.path) {
    return { kind: key.kind, path: key.path };
  }
  return optionalObject({
    kind: key.kind,
    value: compactLiteral(key.value),
    attributes: compactAttributes(key.attributes, limits)
  });
}

function compactAttributes(attributes, limits) {
  if (!Array.isArray(attributes) || attributes.length === 0) {
    return undefined;
  }
  return attributes.slice(0, limits.maxAttributes).map((attribute) =>
    optionalObject({
      name: attribute.name,
      value: compactLiteral(attribute.value)
    })
  );
}

function compactLiteral(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Object.hasOwn(value, "value")) {
    return compactLiteral(value.value);
  }
  if (value.kind === "tree" && value.values && typeof value.values === "object") {
    return {
      kind: "tree",
      values: Object.fromEntries(
        Object.entries(value.values).slice(0, 8).map(([key, entry]) => [
          key,
          compactLiteral(entry)
        ])
      )
    };
  }
  return optionalObject({ kind: value.kind });
}

function optionalObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}
