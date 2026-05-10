export function extractMcdocSymbols(content) {
  const symbols = new Set();
  for (const match of content.matchAll(/\b(?:struct|enum|type|dispatch|module)\s+([A-Za-z0-9_.$:-]+)/gu)) {
    symbols.add(match[1]);
  }
  return [...symbols];
}

export function extractMcdocDefinitions(content, limits) {
  const definitions = [];
  const lines = content.split(/\r\n|\n|\r/u);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const dispatch = line.match(
      /^\s*(?<attributes>(?:#\[[^\]]+\]\s*)*)dispatch\s+(?<target>[^\s]+)\s+to\s+(?<body>.+)$/u
    );
    if (dispatch?.groups) {
      definitions.push({
        kind: "dispatch",
        name: dispatch.groups.target,
        line: index + 1,
        attributes: extractMcdocAttributes(dispatch.groups.attributes),
        target: dispatch.groups.target,
        body: compactMcdocBody(dispatch.groups.body),
        fields: extractInlineOrBlockFields(lines, index, limits)
      });
      continue;
    }

    const struct = line.match(
      /^\s*(?<attributes>(?:#\[[^\]]+\]\s*)*)struct\s+(?<name>[A-Za-z0-9_.$:-]+)\s*(?<body>.*)$/u
    );
    if (struct?.groups) {
      definitions.push({
        kind: "struct",
        name: struct.groups.name,
        line: index + 1,
        attributes: extractMcdocAttributes(struct.groups.attributes),
        fields: extractInlineOrBlockFields(lines, index, limits)
      });
      continue;
    }

    const alias = line.match(
      /^\s*(?<attributes>(?:#\[[^\]]+\]\s*)*)(?<kind>type|enum)\s+(?<name>[A-Za-z0-9_.$:-]+)\b(?<body>.*)$/u
    );
    if (alias?.groups) {
      definitions.push({
        kind: alias.groups.kind,
        name: alias.groups.name,
        line: index + 1,
        attributes: extractMcdocAttributes(alias.groups.attributes),
        body: compactMcdocBody(alias.groups.body)
      });
    }
  }

  return definitions;
}

function extractMcdocAttributes(attributes) {
  return [...attributes.matchAll(/#\[([^\]]+)\]/gu)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function extractInlineOrBlockFields(lines, startIndex, limits) {
  const fields = [];
  const firstLine = lines[startIndex];
  if (!firstLine.includes("{")) {
    return fields;
  }

  let depth = 0;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    depth += countChar(line, "{");
    depth -= countChar(line, "}");

    if (index > startIndex || line.includes("{")) {
      const field = extractMcdocField(line, index + 1);
      if (field) {
        fields.push(field);
      }
    }

    if (depth <= 0 && index > startIndex) {
      break;
    }
  }

  return fields.slice(0, limits.maxFieldsPerDefinition);
}

function extractMcdocField(line, lineNumber) {
  const normalized = line
    .replace(/\/\/\/.*$/u, "")
    .replace(/#\[[^\]]+\]/gu, "")
    .trim();
  if (!normalized || normalized === "{" || normalized === "}") {
    return undefined;
  }
  const spread = normalized.match(/^\.\.\.(?<target>[A-Za-z0-9_.$:[\]-]+),?$/u);
  if (spread?.groups) {
    return {
      kind: "spread",
      name: spread.groups.target,
      line: lineNumber
    };
  }
  const field = normalized.match(
    /^(?<name>[A-Za-z0-9_.$:-]+)(?<optional>\?)?\s*:\s*(?<type>[^,]+),?$/u
  );
  if (!field?.groups) {
    return undefined;
  }

  return {
    kind: "field",
    name: field.groups.name,
    optional: field.groups.optional === "?",
    type: field.groups.type.trim(),
    line: lineNumber
  };
}

function compactMcdocBody(body) {
  return body.trim().replace(/\s+/gu, " ").slice(0, 240);
}

function countChar(value, char) {
  return [...value].filter((item) => item === char).length;
}
