/**
 * Минимальный клиент ЮKassa (API v3) — без SDK, через fetch.
 * Докс: https://yookassa.ru/developers/api
 *
 * Env:
 *   YOOKASSA_SHOP_ID    — идентификатор магазина
 *   YOOKASSA_SECRET_KEY — секретный ключ (боевой или тестовый test_...)
 *   YOOKASSA_RECEIPT_EMAIL_REQUIRED=true — добавлять чек 54-ФЗ в платёж
 *     (требует подключённой онлайн-кассы в кабинете ЮKassa)
 */

import { randomUUID } from 'crypto';

const API_BASE = 'https://api.yookassa.ru/v3';

export interface YooPayment {
  id: string;
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled';
  amount: { value: string; currency: string };
  confirmation?: { type: string; confirmation_url?: string };
  metadata?: Record<string, string>;
  paid: boolean;
}

export function isYooKassaConfigured(): boolean {
  return Boolean(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY);
}

function authHeader(): string {
  const credentials = `${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

async function yooFetch(path: string, init: { method?: string; body?: unknown; idempotenceKey?: string } = {}): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader(),
      ...(init.idempotenceKey ? { 'Idempotence-Key': init.idempotenceKey } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.description || data?.code || `HTTP ${res.status}`;
    throw new Error(`YooKassa API error: ${msg}`);
  }
  return data;
}

export interface CreatePaymentArgs {
  amountRub: number;
  description: string;
  returnUrl: string;
  metadata: Record<string, string>;
  /** email для чека 54-ФЗ (если включены чеки) */
  customerEmail?: string;
}

/** Создаёт платёж с redirect-подтверждением. Возвращает платёж с confirmation_url. */
export async function createPayment(args: CreatePaymentArgs): Promise<YooPayment> {
  const amount = { value: args.amountRub.toFixed(2), currency: 'RUB' };

  const body: any = {
    amount,
    capture: true,
    confirmation: { type: 'redirect', return_url: args.returnUrl },
    description: args.description.slice(0, 128),
    metadata: args.metadata,
  };

  // Чек 54-ФЗ — только если включено и есть email
  if (process.env.YOOKASSA_RECEIPT_EMAIL_REQUIRED === 'true' && args.customerEmail) {
    body.receipt = {
      customer: { email: args.customerEmail },
      items: [{
        description: args.description.slice(0, 128),
        quantity: '1.00',
        amount,
        vat_code: 1,            // без НДС (типично для ИП на УСН)
        payment_subject: 'service',
        payment_mode: 'full_payment',
      }],
    };
  }

  return yooFetch('/payments', {
    method: 'POST',
    body,
    idempotenceKey: randomUUID(),
  });
}

/**
 * Получает платёж по id. ИСПОЛЬЗОВАТЬ В ВЕБХУКЕ:
 * никогда не доверяем телу уведомления — перепроверяем статус напрямую в API.
 */
export async function getPayment(paymentId: string): Promise<YooPayment> {
  return yooFetch(`/payments/${encodeURIComponent(paymentId)}`);
}
