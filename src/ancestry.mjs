// Relação entre o commit do retrato e o commit publicado, para o `audit`
// tolerar divergência que não é drift real.
//
//   'equal'    — mesmo commit
//   'trailing' — diferem só por commits de classe NÃO-runtime, em qualquer
//                sentido (retrato à frente do deploy, ou deploy atrás do
//                retrato sem mudança de runtime)
//   'other'    — divergência real
//
// `git`: { isAncestor(a, b), commitsInRange(from, to), pathsInCommit(sha) }
// `classifier`: de makeClassifier(config)

export function makeAncestry(git, classifier) {
  const rangeAllNonRuntime = (from, to) => {
    const commits = git.commitsInRange(from, to);
    if (commits.length === 0) return false;
    return commits.every((c) => {
      const classes = classifier.classifyPaths(git.pathsInCommit(c), {
        onUnknown: () => {},
      });
      return !classes.has('runtime');
    });
  };

  return function ancestry(snapSha, liveSha) {
    if (!snapSha || !liveSha) return 'other';
    if (
      snapSha === liveSha ||
      snapSha.startsWith(liveSha) ||
      liveSha.startsWith(snapSha)
    ) {
      return 'equal';
    }
    if (git.isAncestor(snapSha, liveSha) && rangeAllNonRuntime(snapSha, liveSha)) {
      return 'trailing';
    }
    if (git.isAncestor(liveSha, snapSha) && rangeAllNonRuntime(liveSha, snapSha)) {
      return 'trailing';
    }
    return 'other';
  };
}
