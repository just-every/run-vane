import type { MailSender } from './modules/operator-auth/index.mjs'
import type { Bindings } from './auth.server'
export function operatorMail(env: Bindings): MailSender | undefined
// REPORT-001: Base's signed delivery-event intake (src/modules/mail/src/events/README.md).
export function verifyWebhook(input: { provider: 'resend' | 'sendgrid'; rawBody: Uint8Array; headers: Headers; key: string; now: number; toleranceSeconds?: number }): Promise<boolean>
export function createD1EventStore(options: { db: D1Database }): unknown
export interface DeliveryEvent { eventId: string; providerMessageId: string; deliveryId: string | null; status: string | null; occurredAt: number; recipients: string[] }
export interface DeliveryResult { eventId: string; outcome: 'stored' | 'duplicate'; recipients: { recipient: string; applied: boolean; state: { status: string; occurredAt: number; eventId: string } }[] }
export function createDeliveryEventIntake(options: { provider: 'resend' | 'sendgrid'; tenantId: string; eventNamespace: string; key: string; store: unknown; clock?: () => number; authorize: (event: DeliveryEvent) => boolean | Promise<boolean> }): { ingestWebhook(input: { rawBody: Uint8Array; headers: Headers }): Promise<DeliveryResult[]> }
