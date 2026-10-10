# Guía para llevar un agente de IA a operaciones

Para líderes que no son expertos en IA, con este proyecto como ejemplo.

## 1. Qué reutilizar tal cual y qué adaptar

**Tal cual:** la conexión de solo lectura a los sistemas, atada al cliente del caso; el enmascarado de datos personales; el paso de aprobación; el servicio separado que ejecuta solo lo aprobado, una vez; el programa que corre los casos de prueba.

**Adapta:** las consultas a tus sistemas; la lista cerrada de acciones (aquí: abrir aclaración, reenviar el CEP, escalar a fraude); las políticas; los casos de prueba, con los de ataque; y la descripción de puesto del agente, en un párrafo. Por ejemplo:

> Lee la cuenta del cliente y nuestras políticas, clasifica el caso, redacta una respuesta y sugiere a lo más una acción de la lista. No mueve dinero, no envía nada al cliente y nunca pide NIP, CVV ni contraseña. Cada caso pasa a una persona, que aprueba o rechaza la acción y firma la respuesta. Si los datos no respaldan lo que propone, entrega el caso sin acción y con el motivo; nunca adivina.

## 2. Reglas que no se negocian

- El agente solo lee.
- La aprobación vive en el código, no en las instrucciones: aunque engañen al agente, no puede saltársela.
- Los datos personales se enmascaran en todas partes.
- Antes de cada cambio corren los casos de prueba, con los de ataque.
- Un tope de gasto por intento y un máximo de intentos por caso (aquí, USD 0.5 por intento y 3 intentos, más 3 repeticiones que pide una persona).
- El cliente siempre puede llegar a una persona.
- Si un agente llega a tener una herramienta que escribe, lleva un límite en pesos aplicado en código.

## 3. Cómo saber que está listo para producción

- Resistió cada caso de ataque en tres de tres intentos (aquí, el sistema frenó 30 de 30 intentos).
- El calificador automático detecta los errores que detecta una persona (aquí aún falta compararlo en 62 respuestas).
- Costo y tiempo por caso dentro del presupuesto.
- Alertas conectadas, cada una con su responsable.
- Probado contra casos reales cerrados hace poco.
- Despliegue: en sombra (nadie usa lo que propone) → copiloto (este proyecto) → envío automático solo de respuestas de bajo riesgo sin acción, revisando una muestra del 10 al 20 %. Las acciones nunca se automatizan.
- La medida es si el cliente vuelve a escribir en 7 días: una aprobación no es una resolución.

## Quién es dueño

- Una persona con nombre y una revisión semanal.
- El botón de apagado, probado: sin agente, los casos se trabajan a mano.
- Cada operador nuevo revisa primero los casos de práctica con errores sembrados.

## Si el agente se porta mal

1. Apágalo.
2. Revisa las acciones ejecutadas en ese periodo.
3. Convierte el caso en un caso de prueba.
4. Vuelve a encenderlo solo cuando pase todos los casos de ataque.

Detalle técnico: [DESIGN.md](DESIGN.md).
