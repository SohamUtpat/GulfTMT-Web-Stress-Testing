/**
 * WS echo correlation aligned with chat-service (no backend change).
 *
 * Why this exists
 * ---------------
 * Clients / k6 send uniqueMessageId on SEND. Root SIMPLE usually keeps that
 * client id. processReplyMessage often generates a new uniqueMessageId and
 * does not keep the outbound id. Live delivery is still correct; the echo's
 * uniqueMessageId may differ from what k6 sent.
 *
 * Do not treat echo.uniqueMessageId !== outbound.uniqueMessageId as a
 * delivery failure for REPLY (or any path through reply processing).
 *
 * Same rules at every load size (100 / 1k / 10k / 30k). Only VUs, hold, and
 * thresholds may change per run — not matching.
 *
 * Matching rules (stable)
 * -----------------------
 * 1. uniqueMessageId exact hit against pending outbound — used when the
 *    backend preserved the client id (typical SIMPLE / root; some
 *    saveSingleReply paths).
 * 2. REPLY / sub-REPLY (primary when rule 1 misses):
 *      senderId === this VU's user
 *      messageType === REPLY
 *      repliedOnChatId parent id === the parent Mongo id we waited for
 *      optional content match against the outbound body
 *      echo arrived for a pending send (in-time or already marked timedOut)
 * 3. SIMPLE / root fallback if uniqueMessageId was omitted or rewritten:
 *      senderId === this VU's user
 *      messageType SIMPLE (or empty)
 *      content match when both sides have text
 *
 * When a match is accepted, callers must store the echo's server
 * uniqueMessageId and Mongo `id`, and use those for later repliedOnChatId /
 * thread steps — never a guessed client uniqueMessageId as parent.
 */

export function extractParentChatId(repliedOnChatId) {
    if (!repliedOnChatId) {
        return '';
    }
    const raw = String(repliedOnChatId);
    if (raw.charAt(0) === '{') {
        try {
            const parsed = JSON.parse(raw);
            return parsed && parsed.chatId ? String(parsed.chatId) : '';
        } catch (e) {
            return '';
        }
    }
    return raw;
}

export function normalizeMessageType(value) {
    return String(value || '').toUpperCase();
}

export function contentSnippet(value, maxLen) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    const limit = maxLen || 40;
    if (text.length <= limit) {
        return text;
    }
    return text.substring(0, limit);
}

function idsEqual(a, b) {
    if (a == null || b == null || a === '' || b === '') {
        return false;
    }
    return String(a) === String(b);
}

function kindForPhase(phase) {
    if (phase === 'wait-root') {
        return 'root';
    }
    if (phase === 'wait-reply') {
        return 'reply';
    }
    if (phase === 'wait-subreply') {
        return 'subreply';
    }
    return '';
}

function pendingFitsEcho(pending, msgType, parentId, content) {
    const kind = pending.kind || 'root';
    const pendingContent = String(pending.content || '').trim();

    if (kind === 'root') {
        if (msgType && msgType !== 'SIMPLE') {
            return false;
        }
        if (parentId) {
            return false;
        }
        if (pendingContent && content && pendingContent !== content) {
            return false;
        }
        return true;
    }

    if (msgType && msgType !== 'REPLY') {
        return false;
    }
    const pendingParent = pending.parentId ? String(pending.parentId) : '';
    if (pendingParent) {
        if (!parentId || pendingParent !== String(parentId)) {
            return false;
        }
    }
    if (pendingContent && content && pendingContent !== content) {
        return false;
    }
    return true;
}

/**
 * Correlate an inbound /queue/reply payload with a pending outbound send.
 *
 * @param {object} parsed inbound chat JSON (uniqueMessageId, id, senderId,
 *        messageType, repliedOnChatId, content)
 * @param {object} ctx
 * @param {object} ctx.pendingByUid outbound uniqueMessageId -> pending
 * @param {string} ctx.userId this VU's senderId
 * @param {string} [ctx.phase] wait-root | wait-reply | wait-subreply | idle
 * @returns {{ pending: object, pendingKey: string, via: string, uidRewritten: boolean } | null}
 *
 * pending: { kind, sentAt, content, senderId, parentId, timedOut }
 */
export function correlateOwnEcho(parsed, ctx) {
    if (!parsed || !ctx || !ctx.pendingByUid) {
        return null;
    }

    const pendingByUid = ctx.pendingByUid;
    const userId = String(ctx.userId || '');
    const inboundUid = parsed.uniqueMessageId ? String(parsed.uniqueMessageId) : '';
    const senderId = parsed.senderId != null ? String(parsed.senderId) : '';
    const msgType = normalizeMessageType(parsed.messageType);
    const parentId = extractParentChatId(parsed.repliedOnChatId);
    const content = String(parsed.content || '').trim();
    const expectedKind = kindForPhase(ctx.phase || '');

    if (inboundUid && pendingByUid[inboundUid]) {
        return {
            pending: pendingByUid[inboundUid],
            pendingKey: inboundUid,
            via: 'uniqueMessageId',
            uidRewritten: false,
        };
    }

    if (!userId || !senderId || senderId !== userId) {
        return null;
    }

    const keys = Object.keys(pendingByUid);
    const candidates = [];
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const pending = pendingByUid[key];
        if (!pending) {
            continue;
        }
        if (pending.senderId != null && String(pending.senderId) !== userId) {
            continue;
        }
        if (!pendingFitsEcho(pending, msgType, parentId, content)) {
            continue;
        }

        let score = 0;
        if (expectedKind && pending.kind === expectedKind) {
            score += 8;
        }
        if (pending.parentId && idsEqual(pending.parentId, parentId)) {
            score += 4;
        }
        if (pending.content && content && String(pending.content).trim() === content) {
            score += 2;
        }
        if (!pending.timedOut) {
            score += 1;
        }
        candidates.push({
            key: key,
            pending: pending,
            score: score,
            sentAt: pending.sentAt || 0,
        });
    }

    if (candidates.length === 0) {
        return null;
    }

    candidates.sort(function (a, b) {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        return a.sentAt - b.sentAt;
    });

    const best = candidates[0];
    const via =
        best.pending.kind === 'root' ? 'root-sender-content' : 'reply-parent-sender';
    return {
        pending: best.pending,
        pendingKey: best.key,
        via: via,
        uidRewritten: inboundUid !== String(best.key),
    };
}

/**
 * Debug line for a backend uniqueMessageId rewrite. Not a delivery failure.
 */
export function formatUidRewriteLog(vu, parsed, result) {
    const pending = result && result.pending ? result.pending : {};
    const parentId =
        extractParentChatId(parsed && parsed.repliedOnChatId) || pending.parentId || '';
    return (
        `VU${vu} uniqueMessageId rewrite (not a delivery failure) ` +
        `kind=${pending.kind || '?'} via=${result && result.via ? result.via : '?'} ` +
        `outbound=${result && result.pendingKey ? result.pendingKey : ''} ` +
        `inbound=${parsed && parsed.uniqueMessageId ? parsed.uniqueMessageId : ''} ` +
        `parent=${parentId} ` +
        `content=${contentSnippet(parsed && parsed.content, 40)}`
    );
}
