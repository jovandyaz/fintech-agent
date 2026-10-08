import {
  WEBHOOK_HEADERS,
  WebhookEventSchema,
  verifyWebhook,
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

import type { Database } from '../database/index.js';
import {
  IntakeConflictError,
  intakeEvent,
  payloadHashOf,
  type Intake,
} from './intake.js';

/** The provider of what the webhook controller needs. */
export const WEBHOOK_DEPS = 'WEBHOOK_DEPS';

/** What the webhook needs: the database, the secrets it verifies with, a clock. */
export interface WebhookDeps {
  db: Database;
  secrets: readonly Buffer[];
  now: () => Date;
}

const MS_PER_SECOND = 1000;
const REFUSAL = {
  signature: 'invalid_signature',
  webhookId: 'webhook_id_mismatch',
  body: 'invalid_body',
  mediaType: 'json_only',
} as const;
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
  ): Promise<Omit<Intake, 'outcome'>> {
    if (!request.is(JSON_TYPE)) {
      throw new UnsupportedMediaTypeException({ message: REFUSAL.mediaType });
    }
    const now = this.deps.now();
    const id = request.header(WEBHOOK_HEADERS.id);
    const verdict = verifyWebhook({
      id,
      timestamp: request.header(WEBHOOK_HEADERS.timestamp),
      signature: request.header(WEBHOOK_HEADERS.signature),
      body: request.rawBody ?? Buffer.alloc(0),
      secrets: this.deps.secrets,
      nowS: Math.floor(now.getTime() / MS_PER_SECOND),
    });
    if (verdict !== 'valid') {
      throw new UnauthorizedException({ message: REFUSAL.signature });
    }
    const parsed = WebhookEventSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestException({ message: REFUSAL.body });
    }
    if (parsed.data.event_id !== id) {
      throw new BadRequestException({ message: REFUSAL.webhookId });
    }
    try {
      const { outcome, ...answer } = await intakeEvent(this.deps.db, {
        event: parsed.data,
        payloadHash: payloadHashOf(request.rawBody ?? Buffer.alloc(0)),
        source: 'webhook',
        now,
      });
      response.status(
        outcome === 'created' ? HttpStatus.ACCEPTED : HttpStatus.OK,
      );
      return answer;
    } catch (error) {
      if (!(error instanceof IntakeConflictError)) throw error;
      this.logger.warn({
        event: 'webhook_conflict',
        conflict: error.conflict,
        event_id: parsed.data.event_id,
      });
      throw new ConflictException({ message: error.conflict });
    }
  }
}
