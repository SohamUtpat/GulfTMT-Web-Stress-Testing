import { SharedArray } from 'k6/data';
import { assertVuUsersAreGroupMembers } from './lib/group-membership.js';

/**
 * Standalone Point 7 check — no WebSocket load.
 *
 *   k6 run -e VUS=500 Scripts/check-group-membership.js
 *   k6 run -e VUS=30000 Scripts/check-group-membership.js
 *
 * Exit non-zero if any of the first VUS token users are not in the test group.
 */

const users = new SharedArray('users', function () {
    const raw = JSON.parse(open('../data/users_result.json'));
    const keys = Object.keys(raw).sort((a, b) => Number(a) - Number(b));
    const list = [];
    for (let i = 0; i < keys.length; i++) {
        const u = raw[keys[i]];
        if (u && u.sender_token) {
            list.push({
                userId: u.sender_id,
                userName: u.user_code,
                senderName: u.sender_name,
                token: u.sender_token,
            });
        }
    }
    return list;
});

const groupChat = JSON.parse(open('../data/group-chat.json'));
const VUS = Number(__ENV.VUS || 500);

if (!Number.isFinite(VUS) || VUS < 1) {
    throw new Error('Invalid VUS=' + __ENV.VUS);
}
if (VUS > users.length) {
    throw new Error('VUS=' + VUS + ' but only ' + users.length + ' tokens in users_result.json');
}

export const options = {
    vus: 1,
    iterations: 1,
    setupTimeout: '3m',
};

export function setup() {
    assertVuUsersAreGroupMembers({
        users: users,
        groupId: groupChat.groupId,
        wsUrl: groupChat.wsUrl,
        vus: VUS,
    });
    return {};
}

export default function () {
    // Membership is verified in setup().
}
