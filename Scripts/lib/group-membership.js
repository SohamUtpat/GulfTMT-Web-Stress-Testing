/**
 * Fail-fast group membership check (Point 7).
 *
 * Every VU user must belong to data/group-chat.json groupId. Missing members
 * look like chat/reply failures (no echo, unauthorized reply) even when
 * chat-service is healthy.
 *
 * Same check at every load size. Run in k6 setup() before any WebSocket.
 *
 * GET /api/user-management-service/group/{groupId}/users
 *
 * Env:
 *   CHECK_GROUP_MEMBERSHIP  default true. false / 0 / skip to disable.
 *   HTTP_BASE_URL           optional. Default: https host derived from wsUrl.
 *   MEMBERSHIP_PAGE_SIZE    default 200.
 */

import http from 'k6/http';

export function isMembershipCheckEnabled() {
    const raw = String(__ENV.CHECK_GROUP_MEMBERSHIP || '').toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off' || raw === 'skip') {
        return false;
    }
    return true;
}

export function httpBaseFromWsUrl(wsUrl) {
    const override = String(__ENV.HTTP_BASE_URL || '').trim();
    if (override) {
        return override.replace(/\/$/, '');
    }
    let base = String(wsUrl || '');
    base = base.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
    base = base.replace(/\/api\/chat-service\/chat\/?$/i, '');
    base = base.replace(/\/$/, '');
    return base;
}

function memberId(row) {
    if (!row) {
        return '';
    }
    if (row.id) {
        return String(row.id);
    }
    if (row.userId) {
        return String(row.userId);
    }
    return '';
}

function parseUsersPage(body) {
    const data = body && body.data ? body.data : {};
    const list = data.users || [];
    const total = Number(data.total != null ? data.total : list.length);
    const ids = [];
    for (let i = 0; i < list.length; i++) {
        const id = memberId(list[i]);
        if (id) {
            ids.push(id);
        }
    }
    return { ids: ids, total: total };
}

/**
 * Throws if any of the first `vus` token users are not members of groupId.
 * Call from setup() only (once per test, not per VU).
 *
 * @param {object} opts
 * @param {Array} opts.users  SharedArray / list of { userId, userName, token }
 * @param {string} opts.groupId
 * @param {string} opts.wsUrl
 * @param {number} opts.vus
 */
export function assertVuUsersAreGroupMembers(opts) {
    if (!isMembershipCheckEnabled()) {
        console.log('CHECK_GROUP_MEMBERSHIP=false — skipping group membership pre-check');
        return;
    }

    const users = opts.users || [];
    const groupId = String(opts.groupId || '');
    const vus = Number(opts.vus || 0);
    const toCheck = Math.min(vus, users.length);

    if (!groupId) {
        throw new Error('CHECK_GROUP_MEMBERSHIP: group-chat.json is missing groupId');
    }
    if (toCheck < 1) {
        throw new Error('CHECK_GROUP_MEMBERSHIP: no VU users to verify');
    }
    if (!users[0] || !users[0].token) {
        throw new Error('CHECK_GROUP_MEMBERSHIP: first user has no sender_token');
    }

    const httpBase = httpBaseFromWsUrl(opts.wsUrl);
    if (!httpBase) {
        throw new Error(
            'CHECK_GROUP_MEMBERSHIP: could not derive HTTP_BASE_URL from wsUrl. Set -e HTTP_BASE_URL=https://host'
        );
    }

    const pageSize = Math.max(1, Number(__ENV.MEMBERSHIP_PAGE_SIZE || 200));
    const headers = {
        Authorization: 'Bearer ' + users[0].token,
        Accept: 'application/json',
    };

    const memberIds = {};
    const neededIds = {};
    let neededLeft = 0;
    for (let i = 0; i < toCheck; i++) {
        const id = users[i] && users[i].userId ? String(users[i].userId) : '';
        if (id && !neededIds[id]) {
            neededIds[id] = true;
            neededLeft += 1;
        }
    }

    let total = -1;
    let page = 0;
    const maxPages = 400;

    while (page < maxPages) {
        const url =
            httpBase +
            '/api/user-management-service/group/' +
            encodeURIComponent(groupId) +
            '/users?searchTerm=&page=' +
            page +
            '&size=' +
            pageSize;
        const res = http.get(url, { headers: headers, timeout: '60s' });
        if (!res || res.status < 200 || res.status >= 300) {
            const snippet = res && res.body ? String(res.body).substring(0, 180) : 'no body';
            throw new Error(
                'CHECK_GROUP_MEMBERSHIP: GET group users failed ' +
                    (res ? res.status : 'n/a') +
                    ' ' +
                    url +
                    ' — ' +
                    snippet
            );
        }

        let parsed;
        try {
            parsed = res.json();
        } catch (e) {
            throw new Error('CHECK_GROUP_MEMBERSHIP: group users response was not JSON');
        }

        const pageData = parseUsersPage(parsed);
        if (total < 0) {
            total = pageData.total;
            console.log(
                'CHECK_GROUP_MEMBERSHIP | group=' +
                    groupId +
                    ' members=' +
                    total +
                    ' checking first ' +
                    toCheck +
                    ' VU users via ' +
                    httpBase
            );
        }

        for (let i = 0; i < pageData.ids.length; i++) {
            const id = pageData.ids[i];
            memberIds[id] = true;
            if (neededIds[id]) {
                delete neededIds[id];
                neededLeft -= 1;
            }
        }

        if (neededLeft <= 0) {
            break;
        }
        if (pageData.ids.length === 0) {
            break;
        }
        if (Object.keys(memberIds).length >= total && total >= 0) {
            break;
        }
        page += 1;
    }

    const missing = [];
    for (let i = 0; i < toCheck; i++) {
        const u = users[i];
        const id = u && u.userId ? String(u.userId) : '';
        if (!id || !memberIds[id]) {
            missing.push((u && u.userName ? u.userName : '?') + ' (' + id + ')');
        }
    }

    if (missing.length === 0) {
        console.log(
            'CHECK_GROUP_MEMBERSHIP ok | ' + toCheck + '/' + toCheck + ' VU users are members of ' + groupId
        );
        return;
    }

    const shown = missing.slice(0, 20).join(', ');
    const more = missing.length > 20 ? ' … +' + (missing.length - 20) + ' more' : '';
    throw new Error(
        'CHECK_GROUP_MEMBERSHIP failed: ' +
            missing.length +
            ' of ' +
            toCheck +
            ' VU users are NOT members of group ' +
            groupId +
            '. Reply/echo failures would be a data issue, not chat-service. ' +
            'Missing (first 20): ' +
            shown +
            more +
            '. Fix: run data/sql/ensure-stress-users-in-test-group.sql against UAT. ' +
            'Skip this check: -e CHECK_GROUP_MEMBERSHIP=false'
    );
}
