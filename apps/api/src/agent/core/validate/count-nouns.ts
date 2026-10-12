/**
 * Plural nouns a figure counts ("3 cargos"): a count is not read. No
 * singulars: once accents go, "pasó" and "cuenta" read as nouns, so "1500
 * pasó" would hide 1500. Only "1" takes a singular, and it is no figure.
 */
export const COUNT_NOUNS = [
  'movimientos',
  'cargos',
  'transacciones',
  'operaciones',
  'compras',
  'transferencias',
  'pagos',
  'intentos',
  'veces',
  'pasos',
  'digitos',
  'documentos',
  'aclaraciones',
  'casos',
  'tarjetas',
  'cuentas',
  'opciones',
  'cobros',
  'abonos',
  'depositos',
  'reembolsos',
  'devoluciones',
  'retiros',
  'comercios',
  'solicitudes',
  'factores',
] as const;
