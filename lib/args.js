/** Form helpers for contract arguments, driven by the API's per-function JSON Schema (self-contained, JSON-contract conventions). */

/** `Option<T>` arrives as `anyOf: [T, null]`; the form treats it as its single non-null arm so widget and placeholder agree. */
export function unwrapOption(schema = {}) {
  if (!Array.isArray(schema.anyOf)) return schema;
  const arms = schema.anyOf.filter((s) => s && s.type !== 'null');
  return arms.length === 1 ? arms[0] : schema;
}

export function fieldKind(schema = {}) {
  if (schema.type === 'boolean') return 'boolean';
  const s = unwrapOption(schema);
  if (s.type === 'boolean') return 'json';   // Option<bool>: a checkbox has no way to say "absent"
  if (s.type === 'integer') return 'integer';
  if (s.type === 'string') return 'string';
  return 'json'; // object, array, unions, tuples, multi-arm anyOf
}

export function placeholderFor(schema = {}) {
  const s = unwrapOption(schema);
  const d = s.description || '';
  if (Array.isArray(s.enum)) return String(s.enum[0]);   // C-style enum: only a declared case is valid, and it is an integer
  if (s.type === 'integer') return '0';
  if (s.type === 'boolean') return 'true';
  if (s.type === 'string') {
    if (/decimal string/i.test(d) || /^\^-\?\[0-9\]\+\$$/.test(s.pattern || '') || /^\^\[0-9\]\+\$$/.test(s.pattern || '')) return '0';
    if (/address/i.test(d)) return 'G…';
    if (/hex/i.test(d) || /0x/.test(s.pattern || '')) return '0x…';
    return 'text';
  }
  if (s.type === 'object') return '{}';
  if (s.type === 'array') return '[]';
  if (Array.isArray(s.oneOf)) {
    const c = s.oneOf[0] || {};
    if ('const' in c) return JSON.stringify(c.const);      // void case → the bare name
    return JSON.stringify({ tag: c.properties?.tag?.const ?? '…', values: [] });
  }
  if (Array.isArray(s.anyOf)) return placeholderFor(s.anyOf.find((a) => a.type !== 'null') || {});
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
    if (empty) { if (required) errors[name] = 'Required'; continue; }   // optionals left blank are omitted, not sent as '' / NaN
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
