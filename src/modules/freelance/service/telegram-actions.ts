import { messagesFor } from "../../../i18n/messages";
import { localePrefix } from "@intgetion/kit";
import { toAppLocale } from "@intgetion/kit";
import type { AppLocale } from "@intgetion/kit";
import { HttpError } from "@intgetion/kit";
import { logger } from "@intgetion/kit";
import { enforceRateLimit } from "../../../platform";
import { siteUrl } from "@intgetion/kit";
import {
  isTelegramOrderAction,
  readTelegramAction,
  signTelegramAction,
  telegramActionSecret,
} from "@intgetion/kit";
import {
  answerTelegramCallback,
  sendTelegramLinks,
  sendTelegramMessage,
  userIdForTelegramId,
} from "../../../platform";
import {
  getOrderForParty,
  transitionOrder,
  type PartyOrder,
} from "./order-service";

type CallbackUpdate = {
  callback_query?: {
    id?: string;
    data?: string;
    from?: { id?: number; language_code?: string };
    message?: { chat?: { id?: number } };
  };
};

function localeOf(code: string | undefined): AppLocale {
  const lower = (code ?? "").toLowerCase();
  return toAppLocale(lower.startsWith("pt") ? "pt-BR" : lower.split("-")[0]);
}

async function partyOrder(
  userId: string,
  orderId: string,
): Promise<PartyOrder | null> {
  try {
    return await getOrderForParty(userId, orderId);
  } catch (error) {
    if (error instanceof HttpError) return null;
    throw error;
  }
}

/**
 * «Accept»/«Decline» under a new request in Telegram (D456). The first tap
 * asks again; the second moves the order through `transitionOrder`, as the
 * seller whose Telegram is linked. Returns false for any other update.
 */
export async function handleFreelanceTelegramCallback(
  token: string,
  update: unknown,
): Promise<boolean> {
  const callback = (update as CallbackUpdate).callback_query;
  if (!callback || !isTelegramOrderAction(callback.data)) return false;
  if (callback.id) {
    await answerTelegramCallback(token, callback.id).catch(() => undefined);
  }
  const chatId = callback.message?.chat?.id;
  const fromId = callback.from?.id;
  if (typeof chatId !== "number" || typeof fromId !== "number") return true;
  const secret = telegramActionSecret(token);
  const action = readTelegramAction(secret, callback.data ?? "");
  if (!action) return true;
  try {
    await enforceRateLimit("freelanceTelegramAction", String(fromId));
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) return true;
    throw error;
  }

  const locale = localeOf(callback.from?.language_code);
  const copy = messagesFor(locale).freelance.telegram;
  const reply = (
    text: string,
    button?: { label: string; data: string },
  ): Promise<void> =>
    sendTelegramMessage(token, chatId, text, button).catch((error: unknown) => {
      logger.warn({ err: error }, "freelance telegram reply failed");
    });

  const userId = await userIdForTelegramId(fromId);
  const order = userId ? await partyOrder(userId, action.orderId) : null;
  if (!userId || !order || order.side !== "seller") {
    await reply(copy.notYours);
    return true;
  }
  if (order.status !== "sent") {
    await reply(copy.stale);
    return true;
  }
  const accept = action.action === "accept";
  if (action.step === 1) {
    await reply(
      (accept ? copy.confirmAccept : copy.confirmDecline).replace(
        "{serviceTitle}",
        order.serviceTitle,
      ),
      {
        label: accept ? copy.yesAccept : copy.yesDecline,
        data: signTelegramAction(secret, 2, action.action, order.id),
      },
    );
    return true;
  }
  try {
    await transitionOrder({
      orderId: order.id,
      to: accept ? "accepted" : "declined",
      actor: "seller",
      actorId: userId,
    });
  } catch (error) {
    if (
      error instanceof HttpError &&
      (error.status === 404 || error.status === 409)
    ) {
      await reply(copy.stale);
      return true;
    }
    throw error;
  }
  await sendTelegramLinks(
    token,
    chatId,
    accept ? copy.accepted : copy.declined,
    [
      {
        label: copy.openOrder,
        url: `${siteUrl()}${localePrefix(locale)}/freelance/orders/${order.id}`,
      },
    ],
  ).catch((error: unknown) => {
    logger.warn({ err: error }, "freelance telegram reply failed");
  });
  return true;
}
