/**
 * Ordered vs concurrent first-chat-SEND timing.
 *
 * parallel (default): send as soon as STOMP CONNECTED (burst / stress behaviour).
 * sequential (opt-in): VU N sends after the ramp has brought everyone up, then
 *   (N-1) * SEND_STAGGER_MS later, so the group shows user 1, then 2, then 3.
 *
 * firstSendDelayMs() must run in VU context (uses execution.scenario.startTime).
 */

import execution from 'k6/execution';
import { parseK6DurationMs } from './k6-scenario.js';

export function parseSendOrder(raw) {
    const order = String(raw || 'parallel').toLowerCase();
    if (order !== 'sequential' && order !== 'parallel') {
        throw new Error(`Invalid SEND_ORDER=${raw}. Use sequential or parallel.`);
    }
    return order;
}

export function parseSendStaggerMs(raw, fallback) {
    const n = Number(raw === undefined || raw === null || raw === '' ? fallback : raw);
    if (!Number.isFinite(n) || n < 0) {
        throw new Error(`Invalid SEND_STAGGER_MS=${raw}. Use milliseconds (e.g. 300).`);
    }
    return n;
}

/** Wall time from scenario start until peak VUs are up (align sequential slots after this). */
export function sequentialAlignAfterMs(rampStyle, rampUp) {
    if (String(rampStyle || '').toLowerCase() === 'simple') {
        return parseK6DurationMs(rampUp, 10000);
    }
    // scaled: 1m + 1m + 1m + 2m to reach 100% VUs
    return 5 * 60 * 1000;
}

/** Extra socket hold so the last VU can reach its send slot. */
export function sequentialTailMs(sendOrder, vus, staggerMs) {
    if (sendOrder !== 'sequential' || vus < 2) {
        return 0;
    }
    return (vus - 1) * staggerMs;
}

/**
 * Milliseconds to wait after STOMP CONNECTED before the first chat SEND.
 * @param {string} sendOrder sequential | parallel
 * @param {number} staggerMs
 * @param {number} vu k6 __VU (1-based)
 * @param {number} alignAfterMs wait until this many ms after scenario start (usually ramp-up)
 */
export function firstSendDelayMs(sendOrder, staggerMs, vu, alignAfterMs) {
    if (sendOrder !== 'sequential') {
        return 0;
    }
    const start = Number(execution.scenario && execution.scenario.startTime);
    if (!Number.isFinite(start)) {
        return (vu - 1) * staggerMs;
    }
    const slotAt = start + (alignAfterMs || 0) + (vu - 1) * staggerMs;
    return Math.max(0, slotAt - Date.now());
}
