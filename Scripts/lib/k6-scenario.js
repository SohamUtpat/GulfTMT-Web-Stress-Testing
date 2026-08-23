/**
 * k6 duration / scenario helpers (init-context safe).
 *
 * Used so VU_HOLD_MS can be compared to the ramping-vus timeline. When the
 * hold is longer than the scenario, k6 tears sockets down first; that close
 * is teardown (excluded from ws_send_error_rate), not a failed chat SEND.
 */

/**
 * Parse a k6 duration (30s, 4m, 1h30m, 200ms, or a bare millisecond number).
 * @param {*} raw
 * @param {number} fallbackMs
 * @returns {number}
 */
export function parseK6DurationMs(raw, fallbackMs) {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return fallbackMs;
    }
    if (typeof raw === 'number') {
        return Number.isFinite(raw) ? raw : fallbackMs;
    }
    const s = String(raw).trim().toLowerCase();
    if (/^\d+(\.\d+)?$/.test(s)) {
        const n = Number(s);
        return Number.isFinite(n) ? n : fallbackMs;
    }
    let total = 0;
    let matched = false;
    const re = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
        matched = true;
        const n = Number(m[1]);
        const unit = m[2];
        if (unit === 'ms') {
            total += n;
        } else if (unit === 's') {
            total += n * 1000;
        } else if (unit === 'm') {
            total += n * 60 * 1000;
        } else if (unit === 'h') {
            total += n * 3600 * 1000;
        } else if (unit === 'd') {
            total += n * 86400 * 1000;
        }
    }
    return matched ? Math.round(total) : fallbackMs;
}

/**
 * Approximate wall time of the ramping-vus stages + gracefulRampDown.
 * @param {object} opts
 * @param {string} opts.rampStyle  scaled | simple
 * @param {string} opts.hold
 * @param {string} [opts.rampUp]
 * @param {string} [opts.rampDown]
 * @param {string} opts.gracefulRampDown
 * @returns {number} milliseconds
 */
export function rampingScenarioDurationMs(opts) {
    const holdMs = parseK6DurationMs(opts.hold, 0);
    const gracefulMs = parseK6DurationMs(opts.gracefulRampDown, 0);
    if (String(opts.rampStyle || '').toLowerCase() === 'simple') {
        return (
            parseK6DurationMs(opts.rampUp, 0) +
            holdMs +
            parseK6DurationMs(opts.rampDown, 0) +
            gracefulMs
        );
    }
    // scaled: 1m + 1m + 1m + 2m + HOLD + 1m + 1m + 1m
    return 8 * 60 * 1000 + holdMs + gracefulMs;
}
