import { sql } from "drizzle-orm";
import { getDb } from "@intgetion/kit";

/**
 * Queries for order payments (28.6, D463). The payout address is the
 * account wallet (D518), read through the users module.
 */

/** Payments still on their way to this address, and unpaid orders (D518). */
export async function paymentsInFlightTo(
  sellerId: string,
  address: string,
): Promise<{ open_payments: number; unpaid_orders: number }> {
  const rows = await getDb().execute<{
    open_payments: number;
    unpaid_orders: number;
  }>(sql`
    select
      (select count(*)::int from public.freelance_order_payments p
         join public.freelance_orders o on o.id = p.order_id
        where o.seller_id = ${sellerId}
          and p.recipient = ${address}
          and p.status in ('open', 'submitted')) as open_payments,
      (select count(*)::int from public.freelance_orders o
        where o.seller_id = ${sellerId}
          and o.status = 'accepted'
          and not exists (
            select 1 from public.freelance_order_payments p
            where p.order_id = o.id and p.status = 'confirmed'
          )) as unpaid_orders
  `);
  return rows[0] ?? { open_payments: 0, unpaid_orders: 0 };
}

export type OrderPaymentRow = {
  id: string;
  order_id: string;
  buyer_id: string | null;
  chain: string;
  token: string;
  token_contract: string;
  recipient: string;
  payer_address: string;
  amount_minor: string;
  token_amount: string;
  status: "open" | "submitted" | "confirmed" | "failed" | "frozen";
  reason: string | null;
  tx_hash: string | null;
  expires_at: string;
  created_at: string;
};

const COLUMNS = sql`
  id, order_id, buyer_id, chain, token, token_contract, recipient,
  payer_address, amount_minor::text, token_amount::text, status, reason,
  tx_hash, expires_at::text, created_at::text
`;

export async function findPayment(id: string): Promise<OrderPaymentRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await getDb().execute<OrderPaymentRow>(sql`
    select ${COLUMNS} from public.freelance_order_payments where id = ${id}
  `);
  return rows[0] ?? null;
}

/** The newest payment of an order, any status. */
export async function latestPayment(
  orderId: string,
): Promise<OrderPaymentRow | null> {
  const rows = await getDb().execute<OrderPaymentRow>(sql`
    select ${COLUMNS} from public.freelance_order_payments
    where order_id = ${orderId}
    order by (status = 'confirmed') desc, created_at desc
    limit 1
  `);
  return rows[0] ?? null;
}

export async function insertPayment(input: {
  orderId: string;
  buyerId: string;
  chain: string;
  token: string;
  tokenContract: string;
  recipient: string;
  payerAddress: string;
  amountMinor: bigint;
  tokenAmount: bigint;
  expiresAt: Date;
}): Promise<OrderPaymentRow> {
  const rows = await getDb().execute<OrderPaymentRow>(sql`
    insert into public.freelance_order_payments (
      order_id, buyer_id, chain, token, token_contract, recipient,
      payer_address, amount_minor, token_amount, expires_at
    ) values (
      ${input.orderId}, ${input.buyerId}, ${input.chain}, ${input.token},
      ${input.tokenContract}, ${input.recipient}, ${input.payerAddress},
      ${input.amountMinor.toString()}, ${input.tokenAmount.toString()},
      ${input.expiresAt.toISOString()}
    )
    returning ${COLUMNS}
  `);
  const row = rows[0];
  if (!row) throw new Error("freelance_order_payments insert returned nothing");
  return row;
}

/** A check that did not confirm: submitted, failed or frozen. */
export async function markPayment(
  id: string,
  status: "submitted" | "failed" | "frozen",
  reason: string | null,
  txHash: string,
): Promise<void> {
  await getDb().execute(sql`
    update public.freelance_order_payments
    set status = ${status}, reason = ${reason}, tx_hash = ${txHash}, updated_at = now()
    where id = ${id} and status <> 'confirmed'
  `);
}

/**
 * Confirms one payment. The partial unique indexes refuse a hash that already
 * paid and a second paid payment of the same order; that error is the caller's.
 */
export async function confirmPayment(
  id: string,
  txHash: string,
): Promise<boolean> {
  const rows = await getDb().execute<{ id: string }>(sql`
    update public.freelance_order_payments
    set status = 'confirmed', reason = null, tx_hash = ${txHash},
        confirmed_at = now(), updated_at = now()
    where id = ${id} and status <> 'confirmed'
    returning id
  `);
  return rows.length > 0;
}

/** Payments the cron looks at again: still waiting on the network. */
export async function submittedPayments(
  limit: number,
): Promise<OrderPaymentRow[]> {
  return getDb().execute<OrderPaymentRow>(sql`
    select ${COLUMNS} from public.freelance_order_payments
    where status = 'submitted' and tx_hash is not null
    order by created_at
    limit ${limit}
  `);
}

/** Confirmed payments whose order still waits in `accepted` (a missed move). */
export async function paidButAccepted(
  limit: number,
): Promise<OrderPaymentRow[]> {
  return getDb().execute<OrderPaymentRow>(sql`
    select ${sql.raw(
      "p.id, p.order_id, p.buyer_id, p.chain, p.token, p.token_contract, p.recipient, p.payer_address, p.amount_minor::text, p.token_amount::text, p.status, p.reason, p.tx_hash, p.expires_at::text, p.created_at::text",
    )}
    from public.freelance_order_payments p
    join public.freelance_orders o on o.id = p.order_id
    where p.status = 'confirmed' and o.status = 'accepted'
    limit ${limit}
  `);
}
