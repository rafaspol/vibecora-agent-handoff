import { JSON_SCHEMA, dump, load } from 'js-yaml';

// Wrapper fino sobre js-yaml com o JSON_SCHEMA (sem tipos YAML implícitos como
// datas — timestamps ficam string, verificáveis).

export function parseYaml(text) {
  return load(text, { schema: JSON_SCHEMA });
}

export function dumpYaml(value) {
  return dump(value, { lineWidth: 80, noRefs: true, schema: JSON_SCHEMA });
}
