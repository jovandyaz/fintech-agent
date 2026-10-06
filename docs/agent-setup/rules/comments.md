---
paths: "**/*.{js,ts,jsx,tsx,mjs,cjs,py,go,rs,java,kt,swift,rb,php,c,cc,cpp,h,hpp,cs}"
---
# Code Comments

Impuesto, no sugerido: `~/.claude/hooks/comment-policy.cjs` bloquea el write en cada
Edit/Write y devuelve la política completa al hacerlo. Knowtis además la corre en CI
como la regla ESLint `knowtis/minimal-comments`.

## Default
Escribe **cero comentarios**. El código se explica con nombres y estructura.

Solo cuatro cosas ganan uno:
- **JSDoc/docstring en API exportada** — contrato, no implementación: precondiciones,
  significado del retorno, efectos secundarios.
- **WHY no obvio** — constraint oculto, invariante sutil, quirk del framework,
  workaround de un bug concreto. Por qué el código se ve raro, no qué hace.
- **TODO / FIXME / HACK** — con contexto suficiente para que el siguiente pueda actuar.
- **Etiqueta de literal opaco** — ≤3 palabras, al final: `'#f87171', // red`.
  Si el valor merece nombre, extrae una constante.

**El filtro, antes de escribir cualquier comentario:** *¿un lector competente del
lenguaje estaría equivocado o atascado sin esto?* Si solo iría algo más lento, bórralo.
"Da contexto", "ayuda al lector" y "registra el tradeoff" NO son justificaciones — para
eso están el mensaje de commit y la descripción del PR.

## Forma
1–3 líneas; **6 es el límite duro**. Multilínea con `//` consecutivos, nunca `/* */`,
nunca cajas de asteriscos o guiones. `/** JSDoc */` se reserva para lo que lee un
*usuario* del código; `//` es para notas de implementación.

## Nunca
- Parafrasear el código — `// increment counter` sobre `counter++`.
- Section headers — `// --- Helpers ---`. Usa espacio en blanco y estructura de módulo.
- Referencias a task / PR / issue — `// fix for #123`, `// changed per CR feedback`.
  Van en el commit y el PR. Se pudren rápido.
- Sellos de autor o fecha — `git blame` es la autoridad.
- Tombstones — `// removed function X`, `// old logic kept for reference`. Si está
  muerto, bórralo; `git log` es el historial.
- Repetir lo que ya dicen el tipo o el nombre — `// userId: the user's id`.
- Sobre-explicar ramas triviales — `// if user is null, return early`.

## Al revisar o simplificar
Borra agresivamente todo comentario que repita el código, referencie un task/PR pasado,
se haya podrido (ya no coincide con el código), o se haya añadido "para claridad" sin
aportar señal sobre los nombres. El codebase es la documentación.
