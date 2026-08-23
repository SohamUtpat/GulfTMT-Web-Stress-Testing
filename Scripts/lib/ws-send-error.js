/**
 * Classify WS/STOMP failures so ws_send_error_rate measures real chat SEND /
 * STOMP failures during the active test — not k6 ramp-down teardown.
 *
 * End-of-scenario noise (seen on short MODE=once runs and at 30k ramp-down):
 *   STOMP ERROR  message:Session closed.
 *   websocket: close 1002 (protocol error)
 * Those often arrive as a pair per VU; counting both inflated the rate (~33%
 * on a 10-VU run where 30/30 chat sends succeeded).
 *
 * ws_msgs_sent is k6's built-in count of *all* socket.send() frames
 * (CONNECT / SUBSCRIBE / DISCONNECT / chat SEND). Do not use it as the
 * denominator for this rate.
 */

function errorText(err) {
    if (err == null) {
        return '';
    }
    if (typeof err === 'string') {
        return err;
    }
    if (typeof err === 'object') {
        return [err.error, err.message, err.name, String(err)].filter(Boolean).join(' ');
    }
    return String(err);
}

export function isSessionClosedStompError(text) {
    return /session\s*closed/i.test(errorText(text));
}

export function isTeardownWsClose(err) {
    const s = errorText(err);
    return (
        /close 1002/i.test(s) ||
        /protocol error/i.test(s) ||
        /close 1001/i.test(s) ||
        /close 1000/i.test(s) ||
        /use of closed network connection/i.test(s) ||
        /websocket: close sent/i.test(s)
    );
}

/**
 * Per-iteration tracker. Create inside default() so state is per VU connection.
 *
 * @param {object} opts
 * @param {object} opts.sendErrors          k6 Counter ws_send_errors
 * @param {object} opts.sendErrorRate       k6 Rate ws_send_error_rate
 * @param {object} opts.teardownCloses      k6 Counter ws_teardown_closes
 * @param {object} opts.sessionClosedErrors k6 Counter ws_session_closed_errors
 * @param {function} opts.shouldLog
 * @param {number} opts.vus
 * @param {number} opts.vu
 */
export function createSendErrorTracker(opts) {
    const sendErrors = opts.sendErrors;
    const sendErrorRate = opts.sendErrorRate;
    const teardownCloses = opts.teardownCloses;
    const sessionClosedErrors = opts.sessionClosedErrors;
    const shouldLog = opts.shouldLog;
    const vus = opts.vus;
    const vu = opts.vu;

    const state = {
        shuttingDown: false,
        teardownCounted: false,
    };

    function clip(detail, n) {
        return String(detail).substring(0, n);
    }

    function logTeardown(kind, detail) {
        if (shouldLog()) {
            console.log(
                `VU${vu} teardown ${kind} (excluded from ws_send_error_rate): ${clip(detail, 180)}`
            );
        }
    }

    function logSendFailure(kind, detail) {
        if (kind === 'send' || vus < 100 || shouldLog()) {
            console.log(`VU${vu} ${kind.toUpperCase()} ERROR: ${clip(detail, 300)}`);
        }
    }

    function recordTeardown(kind, detail) {
        // One session close can arrive as STOMP ERROR *and* WS 1002. Count the
        // session once; do not add either event to ws_send_error_rate.
        state.shuttingDown = true;
        teardownCloses.add(1);
        if (!state.teardownCounted) {
            state.teardownCounted = true;
            sessionClosedErrors.add(1);
        }
        logTeardown(kind, detail);
    }

    function recordSendFailure(kind, detail) {
        sendErrors.add(1);
        sendErrorRate.add(1);
        logSendFailure(kind, detail);
    }

    return {
        beginShutdown() {
            state.shuttingDown = true;
        },

        isShuttingDown() {
            return state.shuttingDown;
        },

        /** Chat SEND threw — always a real send failure. */
        onSendThrow(err) {
            recordSendFailure('send', err);
        },

        /**
         * @returns {boolean} true if this counted as a real send/STOMP error
         */
        onStompError(text) {
            if (
                state.shuttingDown ||
                state.teardownCounted ||
                isSessionClosedStompError(text)
            ) {
                recordTeardown('stomp', text);
                return false;
            }
            recordSendFailure('stomp', text);
            return true;
        },

        /**
         * @returns {boolean} true if this counted as a real send/WS error
         */
        onWsError(err) {
            if (state.shuttingDown || state.teardownCounted || isTeardownWsClose(err)) {
                recordTeardown('ws', err);
                return false;
            }
            recordSendFailure('ws', err);
            return true;
        },
    };
}
