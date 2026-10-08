import {
  WEBHOOK_HEADERS,
  type CaseAcknowledgment,
} from '@fintech-agent/contracts';
import {
  BadRequestException,
  ConflictException,
  Controller,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UnsupportedMediaTypeException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  DELIVERY_REFUSAL,
  DeliveryRefusedError,
  WEBHOOK_DEPS,
  WEBHOOK_SENDER,
  acceptDelivery,
  type WebhookDeps,
} from './delivery.js';
import { IntakeConflictError } from './intake.js';

const MEDIA_TYPE_REFUSAL = 'json_only';
// Only JSON is parsed under the 32 KB limit the signature and the case rely on.
const JSON_TYPE = 'application/json';

/**
 * `POST /webhooks/tickets` (01 §Webhook and queue): verifies the Standard
 * Webhooks signature on the raw bytes before the body is trusted, then
 * records the event and its case. `202` opens a case, `200` repeats an
 * earlier answer; a `401` never says which signature check failed.
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger('Webhooks');

  constructor(@Inject(WEBHOOK_DEPS) private readonly deps: WebhookDeps) {}

  @Post('tickets')
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CaseAcknowledgment> {
    if (!request.is(JSON_TYPE)) {
      throw new UnsupportedMediaTypeException({ message: MEDIA_TYPE_REFUSAL });
    }
    const id = request.header(WEBHOOK_HEADERS.id);
    try {
      const { outcome, ...answer } = await acceptDelivery(
        this.deps,
        {
          id,
          timestamp: request.header(WEBHOOK_HEADERS.timestamp),
          signature: request.header(WEBHOOK_HEADERS.signature),
          body: request.rawBody ?? Buffer.alloc(0),
        },
        { source: 'webhook', opener: WEBHOOK_SENDER },
      );
      response.status(
        outcome === 'created' ? HttpStatus.ACCEPTED : HttpStatus.OK,
      );
      return answer;
    } catch (error) {
      if (error instanceof DeliveryRefusedError) {
        throw error.refusal === DELIVERY_REFUSAL.signature
          ? new UnauthorizedException({ message: error.refusal })
          : new BadRequestException({ message: error.refusal });
      }
      if (!(error instanceof IntakeConflictError)) throw error;
      this.logger.warn({
        event: 'webhook_conflict',
        conflict: error.conflict,
        event_id: id,
      });
      throw new ConflictException({ message: error.conflict });
    }
  }
}
