---
paths: "**/*.{js,ts,jsx,tsx,mjs,cjs}"
---
# JavaScript/TypeScript

Solo lo que difiere del default o es decisión de casa. El resto lo imponen tsconfig,
ESLint y Prettier — no se repite aquí.

- **ES modules siempre**, nunca `require`.
- **Nada de `any`** — `unknown` + type guard. Si un `any` es inevitable, comenta el porqué.
- **Tipos explícitos en APIs exportadas**, inferencia en lo interno.
- `interface` para formas de objeto; `type` para uniones e intersecciones.
- **Named exports** para componentes, nunca `export default`.
- Uniones cerradas derivadas de un array `as const` (`(typeof X)[number]`), nunca `enum`
  (detalle en `magic-values.md`).
