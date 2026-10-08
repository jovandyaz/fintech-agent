---
doc_id: pol-02
title: Devoluciones SPEI y CEP
synthetic: true
sources:
  - Banxico, Circular 14/2017 (reglas del SPEI)
state_rules:
  - section: Abono del monto devuelto
    rule:
      id: return_credit_same_day
      applies_to:
        type: spei_out
        status: returned
        returned_business_days_ago: '>=1'
      requires:
        field: reversal_credit_id
        not_null: true
---

## Causas de devolución

El banco receptor devuelve un SPEI cuando no puede abonarlo, siempre con una causa. Las causas de este documento (lista sintética) son: la cuenta destino no existe, la cuenta destino está bloqueada o el nombre del beneficiario no coincide con el titular de la cuenta. La devolución se informa al cliente con la causa que reportó el banco receptor.

## Abono del monto devuelto

Política interna (sintética): cuando un SPEI enviado es devuelto, el monto se abona de nuevo a la cuenta del cliente el mismo día de la devolución, y el movimiento de reverso queda registrado en su cuenta. Si el reverso no aparece, el caso se revisa: nunca se le dice al cliente que el dinero ya regresó sin ver ese movimiento.

## Comprobante electrónico de pago (CEP)

El CEP solo existe para una transferencia liquidada; no se emite para una transferencia pendiente, rechazada o devuelta. El CEP permite al beneficiario comprobar ante su banco que el pago llegó. Banxico conserva la información para consultar el CEP al menos 3 meses.
