/** Form helpers for contract arguments, driven by the API's per-function JSON Schema (self-contained, JSON-contract conventions). */
export function fieldKind(schema = {}) {
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'integer') return 'integer';
  if (schema.type === 'string') return 'string';
  return 'json'; // object, array, anyOf/oneOf (Option, unions), tuples
}

export function placeholderFor(schema = {}) {
  const d = schema.description || '';
  if (schema.type === 'integer') return '0';
  if (schema.type === 'string') {
    if (/decimal string/i.test(d) || /^\^-\?\[0-9\]\+\$$/.test(schema.pattern || '') || /^\^\[0-9\]\+\$$/.test(schema.pattern || '')) return '0';
    if (/address/i.test(d)) return 'G…';
    if (/hex/i.test(d) || /0x/.test(schema.pattern || '')) return '0x…';
    return 'text';
  }
  if (schema.type === 'object') return '{}';
  if (schema.type === 'array') return '[]';
  if (Array.isArray(schema.anyOf)) return placeholderFor(schema.anyOf.find((s) => s.type !== 'null') || {});
  if (Array.isArray(schema.oneOf)) return JSON.stringify(schema.oneOf[0]?.const ?? '"…"');
  if (Array.isArray(schema.enum)) return String(schema.enum[0]);
  return '';
}

/** values: { [name]: string | boolean } from the form. Returns args ready for the API plus per-field errors. */
export function coerceArgs(inputs, values) {
  const args = {}; const errors = {};
  for (const { name, schema, required } of inputs) {
    const kind = fieldKind(schema);
    const raw = values[name];
    const empty = raw === undefined || raw === null || raw === '';
    if (kind === 'boolean') { args[name] = Boolean(raw); continue; }
    if (empty) { if (required) errors[name] = 'Required'; continue; }
    if (kind === 'integer') {
      const n = Number(raw);
      if (!Number.isInteger(n)) errors[name] = 'Must be an integer'; else args[name] = n;
    } else if (kind === 'string') {
      args[name] = String(raw);
    } else {
      try { args[name] = JSON.parse(raw); } catch (_) { errors[name] = 'Must be valid JSON'; }
    }
  }
  return { args, errors };
}

/** Zip a function's inputs with its JSON Schema so forms have name/type/schema/required in one place. */
export function inputsOf(fn) {
  const props = fn.jsonSchema?.properties || {};
  const req = new Set(fn.jsonSchema?.required || []);
  return fn.inputs.map((i) => ({ name: i.name, type: i.type, schema: props[i.name] || {}, required: req.has(i.name) }));
}
