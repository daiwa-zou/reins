// npm run lessons:check — lint the bundled library and $REINS_HOME/lessons.
// Exits 1 if any error is found (an unknown implication target is one);
// warnings (untyped bullets, missing quotes) do not fail. The component catalogue
// is not checked against the library: components exist without lessons.
// Point it at another library with REINS_HOME=<dir> (reads <dir>/lessons).
import { EXAMPLES_DIR, loadLessonLibrary, lintDir } from "../src/lessons.js";

// --examples lints examples/lessons (the shipped example library) instead of your library.
const lib = process.argv.includes("--examples") ? lintDir(EXAMPLES_DIR) : loadLessonLibrary();
const errors = lib.problems.filter((p) => p.level === "error");
const warns = lib.problems.filter((p) => p.level === "warn");
const dirFor = (s: string) => (s === "user" ? lib.dirs.user : s === "bundled" ? lib.dirs.bundled : "shared/components.ts");
for (const p of lib.problems) console.log(`${p.level === "error" ? "error" : "warn "}  ${p.source === "catalogue" ? "catalogue" : `${dirFor(p.source)}/${p.file}`}: ${p.message}`);
const user = lib.lessons.filter((l) => l.source === "user").length;
console.log(`\n${lib.lessons.length} lessons (${lib.lessons.length - user} bundled, ${user} from ${lib.dirs.user}); ${errors.length} error(s), ${warns.length} warning(s).`);
process.exit(errors.length ? 1 : 0);
