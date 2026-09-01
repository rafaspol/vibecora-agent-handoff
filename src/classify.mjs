import { DEFAULT_CONFIG } from './config.mjs';

// Classificação de caminhos em classes de mudança, dirigida por config.
// As classes são um vocabulário fechado; só `runtime` deveria provocar deploy
// no consumidor.

export const CHANGE_CLASSES = [
  'runtime',
  'process',
  'product_docs',
  'state',
  'general_docs',
];

// Glob simples → RegExp. Suporta `**` (qualquer profundidade), `*` (dentro de
// um segmento) e literais. Sem chaves, sem negação.
function globToRegExp(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          re += '(?:.*/)?'; // `**/` — zero ou mais segmentos de diretório
        } else {
          re += '.*'; // `**` no fim — qualquer coisa, qualquer profundidade
        }
      } else {
        re += '[^/]*'; // `*` — dentro de um segmento
      }
    } else if ('\\^$+?.()|{}[]'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`${re}$`);
}

function compileRules(rules) {
  return rules.map((rule) => ({
    class: rule.class,
    tests: (rule.match || []).map(globToRegExp),
  }));
}

export function makeClassifier(config = DEFAULT_CONFIG) {
  const rules = compileRules(config.classify?.rules || []);
  const unknownClass = config.classify?.unknownClass || 'runtime';

  function classifyPath(rawPath, { onUnknown } = {}) {
    const p = String(rawPath).trim().replace(/^\.\//, '');
    for (const rule of rules) {
      if (rule.tests.some((rx) => rx.test(p))) return rule.class;
    }
    onUnknown?.(p);
    return unknownClass;
  }

  function classifyPaths(paths, { onUnknown } = {}) {
    const out = new Set();
    for (const p of paths || []) {
      if (!p) continue;
      out.add(classifyPath(p, { onUnknown }));
    }
    return out;
  }

  return { classifyPath, classifyPaths, unknownClass };
}
