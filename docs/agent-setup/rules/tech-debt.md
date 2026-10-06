# Tech Debt — Attack Immediately

## Default

No dejar código muerto, código legacy, bugs conocidos ni "fixes pendientes" detrás de ningún cambio. La deuda que no se ataca al momento se olvida y se acumula — el costo de arreglarla nunca vuelve a ser tan bajo como cuando acaba de aparecer.

## Rules

- **Dead code**: si un cambio deja sin consumidores a una función, llave i18n, prop, constante o archivo, se borra en el mismo cambio (verificado con grep, cuidando usos por interpolación/reflección). Nunca "lo limpiamos después".
- **Bugs descubiertos mid-task**: si el fix es chico (≲30 min), se arregla en el mismo batch como commit propio. Si no, se crea el ticket **en el momento** — concreto, con file:line y evidencia — nunca una nota mental ni un "TODO" en el código.
- **El mismo bug en otro lugar**: al arreglar un defecto, grep por sus hermanos (mismo patrón, otro flujo). Los que se encuentren se arreglan o se tickean ahí mismo — un bug arreglado en un solo sitio de tres es deuda nueva, no un fix.
- **Barra "como nuevo"**: el código que se toca queda como si se acabara de escribir bien — sin comentarios podridos, sin props muertas, sin llaves huérfanas, sin workarounds sin dueño.
- **Nada sobrevive un merge sin dueño**: todo minor diferido vive en el ledger de la iniciativa Y llega al triage del review final; si sobrevive al merge, tiene ticket con dueño antes de cerrar la iniciativa.

## Heuristics

- Si al escribir "candidato a ticket" o "follow-up" no se creó el ticket en esa misma sesión, se violó esta regla.
- Un `TODO`/`FIXME` en código solo es válido con ticket vinculado; sin ticket, o se arregla o se borra.
