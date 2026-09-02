/**
 * Generates: Message-Approve-And-Image-Thumbnail-TestCases.xlsx
 * Run: node docs/generate-message-approve-image-thumbnail-testcases.js
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const PLATFORMS = {
  ALL: 'Web, Mobile, Tab, iPad',
  MOBILE: 'Mobile, Tab, iPad',
  WEB: 'Web',
  WEB_TAB: 'Web, Tab',
};

/** Per-test platform overrides (default: all platforms). */
const PLATFORM_OVERRIDES = {
  'UI-APV-009': PLATFORMS.MOBILE,
  'UI-APV-010': PLATFORMS.WEB_TAB,
  'UI-IMG-012': PLATFORMS.MOBILE,
  'NEG-IMG-011': PLATFORMS.WEB,
};

const HEADERS = [
  'Sr. No.',
  'Test Case ID',
  'Platform',
  'Feature / Module',
  'Test Case Title',
  'Preconditions',
  'Test Steps',
  'Expected Result',
  'Priority',
  'Test Data / Notes',
];

function row(id, module, title, pre, steps, expected, priority, notes = '') {
  return [id, module, title, pre, steps, expected, priority, notes];
}

function enrichRows(data) {
  return data.map((r, i) => {
    const id = r[0];
    const platform = PLATFORM_OVERRIDES[id] || PLATFORMS.ALL;
    return [i + 1, id, platform, ...r.slice(1)];
  });
}

const PLATFORM_REFERENCE = [
  ['Platform', 'Description', 'Notes'],
  ['Web', 'Desktop / laptop browser (Chrome, Edge, Firefox, Safari)', 'Mouse, keyboard, hover interactions'],
  ['Mobile', 'Android and iOS native mobile app', 'Tap, swipe, mobile push / live updates'],
  ['Tab', 'Tablet browser or tablet-optimised web layout', 'Touch and wider viewport'],
  ['iPad', 'iPad native app or iPad-optimised layout', 'Touch, split-view, larger screen'],
  ['Web, Mobile, Tab, iPad', 'Cross-platform — execute on all supported clients', 'Default for most chat feature test cases'],
];

const functional = [
  // --- Message Approve ---
  row(
    'FUNC-APV-001',
    'Message Approve',
    'Approve a message from Group chat via 3-dot menu',
    'User A has APPROVER role. Group chat with at least one unapproved message exists.',
    '1. Login as User A (Approver).\n2. Open a Group chat.\n3. Locate an unapproved message.\n4. Tap 3-dot menu on the message.\n5. Select "Approve".',
    'Message is approved successfully. "Approved" badge appears on the message with approver name and timestamp.',
    'High',
    'Group chat'
  ),
  row(
    'FUNC-APV-002',
    'Message Approve',
    'Approve a message from One-to-One chat',
    'User A has APPROVER role. 1:1 conversation with unapproved message exists.',
    '1. Login as User A.\n2. Open a 1:1 chat.\n3. Open 3-dot menu on a message.\n4. Select "Approve".',
    'Message is approved. Approved badge is displayed with correct approver details.',
    'High',
    '1:1 chat'
  ),
  row(
    'FUNC-APV-003',
    'Message Approve',
    'Approve a message from Shared messages view',
    'User A has APPROVER role. At least one shared unapproved message is visible.',
    '1. Login as User A.\n2. Navigate to Shared messages.\n3. Open 3-dot menu on an unapproved message.\n4. Select "Approve".',
    'Message is approved from Shared view. Approved badge appears and persists when reopening Shared view.',
    'High',
    'Shared tab/view'
  ),
  row(
    'FUNC-APV-004',
    'Message Approve',
    'Approve a message from Tagged messages view',
    'User A has APPROVER role. Tagged message exists and is not yet approved.',
    '1. Login as User A.\n2. Navigate to Tagged messages.\n3. Approve a tagged message via 3-dot menu.',
    'Tagged message shows Approved badge. Approval is reflected in original chat context as well.',
    'High',
    'Tagged tab/view'
  ),
  row(
    'FUNC-APV-005',
    'Message Approve',
    'Approve a message from Starred messages view',
    'User A has APPROVER role. Starred unapproved message exists.',
    '1. Login as User A.\n2. Navigate to Starred messages.\n3. Approve a starred message via 3-dot menu.',
    'Starred message displays Approved badge after approval action.',
    'High',
    'Starred tab/view'
  ),
  row(
    'FUNC-APV-006',
    'Message Approve',
    'Approve a message from My Messages view',
    'User A has APPROVER role. Unapproved message visible in My Messages.',
    '1. Login as User A.\n2. Navigate to My Messages.\n3. Approve a message via 3-dot menu.',
    'Message is approved successfully from My Messages view.',
    'High',
    'My Messages tab/view'
  ),
  row(
    'FUNC-APV-007',
    'Message Approve',
    'Approve a message from Latest Messages view',
    'User A has APPROVER role. Unapproved message appears in Latest Messages.',
    '1. Login as User A.\n2. Navigate to Latest Messages.\n3. Approve a message via 3-dot menu.',
    'Message is approved and Approved badge is shown in Latest Messages.',
    'High',
    'Latest Messages tab/view'
  ),
  row(
    'FUNC-APV-008',
    'Message Approve',
    'Approve option removed from 3-dot menu after approval for approving user',
    'User A has APPROVER role. Message is not yet approved.',
    '1. Login as User A.\n2. Approve a message.\n3. Open 3-dot menu on the same message again.',
    '"Approve" option is no longer visible in the 3-dot menu for User A.',
    'High'
  ),
  row(
    'FUNC-APV-009',
    'Message Approve',
    'Approve option removed from 3-dot menu for other group members after User A approves',
    'User A and User B are group members. User A has APPROVER role. User B may or may not have APPROVER role. Message is unapproved.',
    '1. User A approves a message.\n2. User B opens the same message.\n3. User B opens 3-dot menu on that message.',
    '"Approve" option is not shown in 3-dot menu for User B (and all other members).',
    'High',
    'Validates single-approver rule'
  ),
  row(
    'FUNC-APV-010',
    'Message Approve',
    'Second approver cannot approve an already approved message',
    'User A and User C both have APPROVER role. User A has already approved the message.',
    '1. User A approves a message.\n2. Login as User C.\n3. Attempt to approve the same message.',
    'User C cannot approve the message. Approve action is unavailable. Original approver (User A) and timestamp remain unchanged.',
    'High'
  ),
  row(
    'FUNC-APV-011',
    'Message Approve',
    'Approve a reply message independently of parent message',
    'Group thread with parent message and reply exists. Neither is approved. User A has APPROVER role.',
    '1. Approve only the reply (not the parent).\n2. Verify parent and other replies.',
    'Only the selected reply shows Approved badge. Parent and sibling replies remain unapproved unless separately approved.',
    'High',
    'Per screenshot: reply 3 approved, replies 1 & 2 not'
  ),
  row(
    'FUNC-APV-012',
    'Message Approve',
    'Approve a sub-reply independently of parent reply',
    'Thread with main message, reply, and sub-reply exists. User A has APPROVER role.',
    '1. Approve only the sub-reply.\n2. Verify parent message and parent reply.',
    'Only sub-reply shows Approved badge. Parent message and parent reply are unaffected.',
    'High'
  ),
  row(
    'FUNC-APV-013',
    'Message Approve',
    'Approve parent message without approving nested replies',
    'Thread with parent and multiple nested replies. User A has APPROVER role.',
    '1. Approve the parent message only.\n2. Check all nested replies.',
    'Parent shows Approved badge. Nested replies do not inherit approval status.',
    'High'
  ),
  row(
    'FUNC-APV-014',
    'Message Approve',
    'Real-time approval update for other online users in group chat',
    'User A and User B are online in same group. User A has APPROVER role.',
    '1. User B keeps group chat open.\n2. User A approves a message.\n3. Observe User B screen without manual refresh.',
    'User B sees Approved badge appear in real time. Approve option disappears from 3-dot menu for User B.',
    'High',
    'WebSocket / live update'
  ),
  row(
    'FUNC-APV-015',
    'Message Approve',
    'Approval persists after page refresh / re-login',
    'User A approved a message in a group chat.',
    '1. Refresh the page or logout and login again.\n2. Navigate to the same message.',
    'Approved badge, approver name, and timestamp remain visible and accurate.',
    'Medium'
  ),
  row(
    'FUNC-APV-016',
    'Message Approve',
    'Approve message that already has a visual stamp (stamp and approve are independent)',
    'Message has a visual stamp applied by any user. Message is not yet approved. User A has APPROVER role.',
    '1. Open message with existing stamp.\n2. Approve the message via 3-dot menu.',
    'Both visual stamp and Approved badge are displayed. Approval does not remove or replace the stamp.',
    'High',
    'Stamp + Approve coexist'
  ),
  row(
    'FUNC-APV-017',
    'Message Approve',
    'Approve message first, then add stamp by another user',
    'User A approved a message. User B can add stamps. Message is approved.',
    '1. User A approves message.\n2. User B adds a visual stamp to the same message.',
    'Approved badge remains with User A details. Visual stamp is added by User B. Both display together.',
    'Medium'
  ),
  row(
    'FUNC-APV-018',
    'Message Approve',
    'Approved message visible consistently across all entry points',
    'User A approved a message in a group. Message appears in Shared/Tagged/Starred/My Messages/Latest.',
    '1. Approve message in group chat.\n2. Open same message from Shared, Tagged, Starred, My Messages, and Latest Messages.',
    'Approved badge and approver details are consistent across all views.',
    'High'
  ),
  row(
    'FUNC-APV-019',
    'Message Approve',
    'Approver name and timestamp reflect the user who performed approval',
    'User A (Approver) approves at a known time.',
    '1. User A approves message at time T.\n2. Verify badge content.',
    'Badge shows "Approved", User A full/display name, and timestamp matching approval time (MM/DD/YYYY HH:mm format).',
    'High'
  ),
  row(
    'FUNC-APV-020',
    'Message Approve',
    'Approve message sent to multiple groups (simultaneous destination)',
    'Message was sent to multiple groups simultaneously. User A has APPROVER role in source group.',
    '1. User A approves message in one group copy.\n2. Check same message in sibling group copies.',
    'Approval status propagates to all simultaneous copies of the message across groups.',
    'Medium',
    'Multi-send / simultaneous destination'
  ),

  // --- Image Thumbnail ---
  row(
    'FUNC-IMG-001',
    'Image Thumbnail',
    'Single image attachment shows thumbnail on message',
    'User can send messages with image attachments in group chat.',
    '1. Post a message with one image attachment.\n2. Observe the message in chat.',
    'A square image thumbnail is displayed below the message text on the message bubble.',
    'High'
  ),
  row(
    'FUNC-IMG-002',
    'Image Thumbnail',
    'Multiple images (2–5) show as individual thumbnails',
    'User can attach multiple images to one message.',
    '1. Post a message with 3 image attachments.\n2. View the message in chat.',
    'All 3 image thumbnails are visible on the message, arranged in a row.',
    'High'
  ),
  row(
    'FUNC-IMG-003',
    'Image Thumbnail',
    'Horizontal scroll appears when posting ~20–25 images',
    'User can attach 20–25 images to a single message.',
    '1. Post a message with 20–25 images.\n2. Observe thumbnail row on the message.',
    'Thumbnails are displayed in a horizontally scrollable row. User can scroll left/right to view all thumbnails.',
    'High',
    'Per requirement: 20–25 images'
  ),
  row(
    'FUNC-IMG-004',
    'Image Thumbnail',
    'Click thumbnail opens full image preview',
    'Message with at least one image thumbnail is visible.',
    '1. Click/tap on an image thumbnail in a message.',
    'Full-screen or modal image preview opens showing the selected image clearly.',
    'High'
  ),
  row(
    'FUNC-IMG-005',
    'Image Thumbnail',
    'Next button navigates to next image in preview',
    'Message with multiple images. Preview is open on first image.',
    '1. Open image preview from first thumbnail.\n2. Click "Next" button.',
    'Preview displays the next image in the same message attachment order.',
    'High'
  ),
  row(
    'FUNC-IMG-006',
    'Image Thumbnail',
    'Previous button navigates to previous image in preview',
    'Message with multiple images. Preview is open on second or later image.',
    '1. Open preview on 3rd image.\n2. Click "Previous" button.',
    'Preview displays the 2nd image.',
    'High'
  ),
  row(
    'FUNC-IMG-007',
    'Image Thumbnail',
    'Preview navigation wraps or disables at first/last image boundaries',
    'Message with multiple images. Preview open.',
    '1. Open preview on first image — click Previous.\n2. Open preview on last image — click Next.',
    'At first image, Previous is disabled or does not navigate further back. At last image, Next is disabled or does not navigate further forward.',
    'Medium'
  ),
  row(
    'FUNC-IMG-008',
    'Image Thumbnail',
    'Image thumbnails display alongside other attachment types',
    'User can attach images, PDFs, video, voice note, and location in one message.',
    '1. Post message with 1 image + multiple PDFs + video + voice note + location.\n2. View message.',
    'Image thumbnail appears above the file attachment list. Other attachment types (PDF, video, voice, location) display below thumbnails as links/icons.',
    'High',
    'Per screenshot 2'
  ),
  row(
    'FUNC-IMG-009',
    'Image Thumbnail',
    'Image thumbnails visible in group chat replies and sub-replies',
    'Reply/sub-reply with image attachment exists.',
    '1. Send reply with image attachment.\n2. Send sub-reply with image attachment.\n3. View thread.',
    'Thumbnails render correctly within reply and sub-reply bubbles.',
    'Medium'
  ),
  row(
    'FUNC-IMG-010',
    'Image Thumbnail',
    'Image thumbnails visible in 1:1 chat',
    '1:1 conversation exists.',
    '1. Send message with images in 1:1 chat.\n2. Verify thumbnail display and preview.',
    'Thumbnails and preview navigation work same as in group chat.',
    'High'
  ),
  row(
    'FUNC-IMG-011',
    'Image Thumbnail',
    'Image thumbnails visible in Shared / Tagged / Starred / My Messages / Latest views',
    'Message with images exists and appears in aggregate views.',
    '1. Post message with images in group.\n2. Open message from Shared, Tagged, Starred, My Messages, Latest Messages.',
    'Image thumbnails render correctly in all aggregate message views.',
    'Medium'
  ),
  row(
    'FUNC-IMG-012',
    'Image Thumbnail',
    'Preview closes and returns to chat on close/back action',
    'Image preview is open.',
    '1. Open image preview.\n2. Click close (X) or back/escape.',
    'Preview closes and user returns to chat at same scroll position.',
    'Medium'
  ),
  row(
    'FUNC-IMG-013',
    'Image Thumbnail',
    'Thumbnail order matches attachment upload/send order',
    'User selects images in a specific order before sending.',
    '1. Attach images A, B, C in order and send.\n2. Open preview and navigate Next/Previous.',
    'Thumbnail order and preview navigation order match the send order (A → B → C).',
    'Medium'
  ),
  row(
    'FUNC-IMG-014',
    'Image Thumbnail',
    'Thumbnails load for messages received from other users',
    'Another user posts a message with images.',
    '1. User B posts images.\n2. User A views the message.',
    'User A sees all image thumbnails and can open preview with navigation.',
    'High'
  ),
];

const ui = [
  row(
    'UI-APV-001',
    'Message Approve - Badge',
    'Approved badge visual layout matches design',
    'Message has been approved.',
    '1. View an approved message.\n2. Compare badge against design/screenshot.',
    'Badge has red border, rounded corners, blue circular checkmark icon, bold red "Approved" text, approver name, and timestamp in lighter red font.',
    'High',
    'Screenshot 1 reference'
  ),
  row(
    'UI-APV-002',
    'Message Approve - Badge',
    'Approved badge placement on main message',
    'Main message is approved.',
    '1. View approved main message in group chat.',
    'Approved badge appears at the top of the message block, above sender name and message content.',
    'High'
  ),
  row(
    'UI-APV-003',
    'Message Approve - Badge',
    'Approved badge placement on reply message',
    'Reply message is approved.',
    '1. View approved reply inside thread.',
    'Approved badge appears at top of the reply block within the grey reply container.',
    'High'
  ),
  row(
    'UI-APV-004',
    'Message Approve - Badge',
    'Unapproved messages do not show Approved badge',
    'Message exists without approval.',
    '1. View unapproved message.',
    'No Approved badge is displayed.',
    'High'
  ),
  row(
    'UI-APV-005',
    'Message Approve - Menu',
    'Approve option visible in 3-dot menu for unapproved message (Approver user)',
    'User with APPROVER role. Unapproved message.',
    '1. Open 3-dot menu on unapproved message.',
    '"Approve" option is visible and readable in the menu alongside other actions.',
    'High'
  ),
  row(
    'UI-APV-006',
    'Message Approve - Menu',
    'Approve option hidden in 3-dot menu after approval',
    'Message is approved.',
    '1. Open 3-dot menu on approved message as any user.',
    '"Approve" option is not present in the menu.',
    'High'
  ),
  row(
    'UI-APV-007',
    'Message Approve - Badge',
    'Timestamp format on Approved badge',
    'Message approved at known datetime.',
    '1. View Approved badge timestamp.',
    'Timestamp displays in MM/DD/YYYY HH:mm format (e.g., 08/30/2026 16:35).',
    'Medium'
  ),
  row(
    'UI-APV-008',
    'Message Approve - Badge',
    'Approved badge does not overlap stamp or message content',
    'Message has both stamp and approval.',
    '1. View message with visual stamp and Approved badge.',
    'Badge, stamp icon, sender info, and message body are all visible without overlap or clipping.',
    'Medium'
  ),
  row(
    'UI-APV-009',
    'Message Approve - Responsiveness',
    'Approved badge renders correctly on mobile viewport',
    'Mobile device or narrow browser width.',
    '1. Approve message on mobile.\n2. View in group and thread views.',
    'Badge is fully visible, text is not truncated, layout remains readable.',
    'Medium'
  ),
  row(
    'UI-APV-010',
    'Message Approve - Responsiveness',
    'Approved badge renders correctly on desktop/tablet viewport',
    'Desktop or tablet browser.',
    '1. View approved messages at various window sizes.',
    'Badge alignment and spacing remain consistent across desktop and tablet.',
    'Low'
  ),
  row(
    'UI-APV-011',
    'Message Approve - Thread',
    'Mixed approved/unapproved replies display correctly in thread',
    'Thread with some approved and some unapproved replies.',
    '1. View thread per screenshot scenario (parent approved, reply 3 approved, replies 1 & 2 not).',
    'Each message shows badge only when approved. Thread hierarchy and numbering remain clear.',
    'High'
  ),
  row(
    'UI-APV-012',
    'Message Approve - Action Bar',
    'Message action bar icons remain visible after approval',
    'Approved message in chat.',
    '1. View action bar below approved message.',
    'Reply, Like, Star, Read Receipt, Delete, and 3-dot menu icons remain visible and properly aligned.',
    'Medium'
  ),

  row(
    'UI-IMG-001',
    'Image Thumbnail - Display',
    'Thumbnail size and shape consistency',
    'Message with multiple images posted.',
    '1. View message with 3+ image thumbnails.',
    'All thumbnails are square, uniform size, and left-aligned in a row below message text.',
    'High',
    'Screenshot 2 reference'
  ),
  row(
    'UI-IMG-002',
    'Image Thumbnail - Display',
    'Thumbnail appears above non-image attachment list',
    'Message with image + PDF + video attachments.',
    '1. View mixed-attachment message.',
    'Image thumbnail row is positioned above the hyperlinked file attachment list.',
    'High'
  ),
  row(
    'UI-IMG-003',
    'Image Thumbnail - Scroll',
    'Horizontal scroll indicator for many thumbnails',
    'Message with 20+ images.',
    '1. View message with 20–25 thumbnails.\n2. Attempt horizontal scroll.',
    'Overflow thumbnails are accessible via horizontal scroll. Scroll behavior is smooth; partial next thumbnail may peek to indicate more content.',
    'High'
  ),
  row(
    'UI-IMG-004',
    'Image Thumbnail - Scroll',
    'No vertical stacking overflow for many thumbnails',
    'Message with 20+ images.',
    '1. View message with many images.',
    'Thumbnails stay in a single horizontal row (not wrapping into multiple tall rows that break layout).',
    'Medium'
  ),
  row(
    'UI-IMG-005',
    'Image Thumbnail - Preview',
    'Preview modal layout with Next/Previous controls',
    'Multi-image message. Preview open.',
    '1. Open image preview.\n2. Inspect navigation controls.',
    'Preview shows full image with clearly visible Next and Previous buttons/icons. Close control is accessible.',
    'High'
  ),
  row(
    'UI-IMG-006',
    'Image Thumbnail - Preview',
    'Preview image quality and aspect ratio',
    'Image preview open.',
    '1. Open preview for portrait and landscape images.',
    'Images display at appropriate resolution without distortion. Aspect ratio is preserved.',
    'Medium'
  ),
  row(
    'UI-IMG-007',
    'Image Thumbnail - Preview',
    'Preview background overlay dims chat behind modal',
    'Preview open.',
    '1. Open image preview.',
    'Background chat is dimmed/obscured. Focus is on preview content.',
    'Low'
  ),
  row(
    'UI-IMG-008',
    'Image Thumbnail - Loading',
    'Thumbnail placeholder/loading state while image loads',
    'Slow network or large image.',
    '1. Post or receive image message on slow connection.',
    'Placeholder or loading indicator shown until thumbnail loads. No broken image icon on success.',
    'Medium'
  ),
  row(
    'UI-IMG-009',
    'Image Thumbnail - Thread',
    'Thumbnails in nested reply/sub-reply layout',
    'Reply with images in indented thread.',
    '1. View reply and sub-reply with image thumbnails.',
    'Thumbnails fit within indented reply containers without horizontal overflow breaking thread layout.',
    'Medium'
  ),
  row(
    'UI-IMG-010',
    'Image Thumbnail - Accessibility',
    'Thumbnail is clickable/tappable with visible focus or hover state',
    'Desktop and mobile.',
    '1. Hover (desktop) or tap (mobile) on thumbnail.',
    'Clear interactive affordance (cursor pointer, tap highlight, or hover effect) indicates thumbnail is clickable.',
    'Low'
  ),
  row(
    'UI-IMG-011',
    'Image Thumbnail - Mixed Attachments',
    'Non-image attachments retain correct icons below thumbnails',
    'Message with images + PDFs + video + voice + location.',
    '1. View full message attachment area.',
    'PDF (blue doc icon), video (camera icon), voice (music note), location (pin icon) display correctly below image thumbnail row.',
    'Medium',
    'Screenshot 2 reference'
  ),
  row(
    'UI-IMG-012',
    'Image Thumbnail - Responsiveness',
    'Thumbnail row and preview usable on mobile screen',
    'Mobile device.',
    '1. View and scroll thumbnails on mobile.\n2. Open preview and use Next/Previous.',
    'Horizontal scroll works via swipe. Preview and navigation buttons are tappable and not cut off.',
    'High'
  ),
];

const negative = [
  row(
    'NEG-APV-001',
    'Message Approve',
    'Non-approver user cannot see Approve option in 3-dot menu',
    'User B does NOT have APPROVER role. Unapproved message exists.',
    '1. Login as User B.\n2. Open 3-dot menu on unapproved message.',
    '"Approve" option is not available in the menu.',
    'High',
    'APPROVER role required'
  ),
  row(
    'NEG-APV-002',
    'Message Approve',
    'Non-approver user cannot approve via API/direct action',
    'User B without APPROVER role. Known message ID.',
    '1. Attempt approve action via API or manipulated client request as User B.',
    'Request is rejected with insufficient permissions (403). Message remains unapproved.',
    'High'
  ),
  row(
    'NEG-APV-003',
    'Message Approve',
    'Second approver blocked after first approval',
    'User A approved message. User C has APPROVER role.',
    '1. User C attempts to approve same message via menu or API.',
    'Approval fails or option unavailable. First approver details unchanged.',
    'High'
  ),
  row(
    'NEG-APV-004',
    'Message Approve',
    'Approve action on deleted message',
    'Message was deleted before approve attempt.',
    '1. Delete a message.\n2. Attempt to approve deleted message (via deep link, stale UI, or API).',
    'Error shown: message not found. No approval record created.',
    'Medium'
  ),
  row(
    'NEG-APV-005',
    'Message Approve',
    'Approve with invalid / non-existent message ID',
    'User A has APPROVER role.',
    '1. Send approve request with invalid or random message ID.',
    '404 Not Found returned. No side effects.',
    'Medium'
  ),
  row(
    'NEG-APV-006',
    'Message Approve',
    'Approve with blank or missing authentication',
    'No valid session / token.',
    '1. Attempt approve without login or with expired session.',
    '403 Forbidden or 401 Unauthorized. Message not approved.',
    'High'
  ),
  row(
    'NEG-APV-007',
    'Message Approve',
    'Concurrent approve by two approvers on same unapproved message',
    'User A and User C both APPROVER. Same unapproved message.',
    '1. Both users attempt approve at nearly the same time.',
    'Only one approval succeeds. Single approver recorded. No duplicate approval records.',
    'High',
    'Race condition'
  ),
  row(
    'NEG-APV-008',
    'Message Approve',
    'Approve message in group where user is not a member',
    'User A has APPROVER role but is not member of target group.',
    '1. Attempt to approve message in unauthorized group via API.',
    'Access denied. Message not approved.',
    'High'
  ),
  row(
    'NEG-APV-009',
    'Message Approve',
    'Approve option remains hidden after approval even after network reconnect',
    'Message approved. User goes offline then online.',
    '1. User B goes offline.\n2. User A approves message.\n3. User B reconnects and opens message menu.',
    'Approve option still hidden. Approved badge visible.',
    'Medium'
  ),
  row(
    'NEG-APV-010',
    'Message Approve',
    'Spoofed approver ID in request is ignored',
    'User A authenticated. API accepts approver in body.',
    '1. User A sends approve request attempting to set a different user as approver.',
    'System records User A (authenticated caller) as approver, not spoofed ID.',
    'High'
  ),
  row(
    'NEG-APV-011',
    'Message Approve',
    'Re-approve already approved message preserves original approver and timestamp',
    'Message already approved by User A at time T1.',
    '1. Trigger duplicate approve request for same message.',
    'Original approver (User A) and approvedAt (T1) are preserved. No reset of approval metadata.',
    'Medium'
  ),
  row(
    'NEG-APV-012',
    'Message Approve',
    'Approve on message with only text (no attachments) — edge case',
    'Plain text message, no media.',
    '1. Attempt approve on plain text message.',
    'Approval works normally if user has permission (validates approve is not attachment-dependent).',
    'Low'
  ),

  row(
    'NEG-IMG-001',
    'Image Thumbnail',
    'Unsupported or corrupt image file',
    'User attempts to attach invalid/corrupt image.',
    '1. Try to send corrupt or unsupported image format.',
    'Upload rejected or error shown. No broken thumbnail rendered in chat.',
    'High'
  ),
  row(
    'NEG-IMG-002',
    'Image Thumbnail',
    'Very large image file exceeds size limit',
    'System has max attachment size limit.',
    '1. Attempt to send image exceeding max size.',
    'Upload fails with clear error. Message not sent with oversized image.',
    'High'
  ),
  row(
    'NEG-IMG-003',
    'Image Thumbnail',
    'Message with zero images shows no thumbnail row',
    'Message contains only text or non-image files.',
    '1. Send text-only or PDF-only message.',
    'No image thumbnail row displayed.',
    'Medium'
  ),
  row(
    'NEG-IMG-004',
    'Image Thumbnail',
    'Preview Next on single-image message',
    'Message with only 1 image.',
    '1. Open preview.\n2. Click Next.',
    'Next is disabled or has no effect. No blank/error preview screen.',
    'Medium'
  ),
  row(
    'NEG-IMG-005',
    'Image Thumbnail',
    'Preview Previous on single-image message',
    'Message with only 1 image.',
    '1. Open preview.\n2. Click Previous.',
    'Previous is disabled or has no effect.',
    'Medium'
  ),
  row(
    'NEG-IMG-006',
    'Image Thumbnail',
    'Thumbnail fails to load (network error)',
    'Simulate network failure during thumbnail load.',
    '1. Load message with images under network throttling/disconnect.',
    'Graceful fallback (placeholder/retry). Chat layout not broken.',
    'Medium'
  ),
  row(
    'NEG-IMG-007',
    'Image Thumbnail',
    'Preview of deleted message images',
    'Message with images was deleted.',
    '1. Open preview or deep link to deleted message images.',
    'Preview unavailable or appropriate not-found message shown.',
    'Medium'
  ),
  row(
    'NEG-IMG-008',
    'Image Thumbnail',
    'Rapid repeated Next/Previous clicks in preview',
    'Multi-image preview open.',
    '1. Rapidly click Next/Previous multiple times.',
    'Preview navigates correctly without crash, skip, or wrong image order.',
    'Low'
  ),
  row(
    'NEG-IMG-009',
    'Image Thumbnail',
    'Horizontal scroll with only 1–2 images',
    'Message with 1–2 images.',
    '1. View message thumbnails.',
    'No unnecessary scrollbar shown when all thumbnails fit in viewport.',
    'Low'
  ),
  row(
    'NEG-IMG-010',
    'Image Thumbnail',
    'Maximum image count boundary (if limit exists)',
    'System may enforce max images per message.',
    '1. Attempt to attach more than allowed max images (e.g., 30+ if limit is 25).',
    'Excess images rejected with clear message, or only allowed count is sent.',
    'Medium'
  ),
  row(
    'NEG-IMG-011',
    'Image Thumbnail',
    'Preview keyboard navigation edge cases',
    'Preview open on desktop.',
    '1. Press Escape, arrow keys beyond bounds, or Tab.',
    'Escape closes preview. Arrow keys navigate within bounds or are ignored at edges.',
    'Low'
  ),
  row(
    'NEG-IMG-012',
    'Image Thumbnail',
    'Mixed message: image upload failure does not break other attachments',
    'Message with 1 failing image + valid PDF.',
    '1. Send message where one image fails upload but PDF succeeds.',
    'User notified of failure. Successful attachments handled correctly; UI not corrupted.',
    'Medium'
  ),
];

function sheet(name, data) {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...enrichRows(data)]);
  ws['!cols'] = [
    { wch: 8 },
    { wch: 14 },
    { wch: 22 },
    { wch: 28 },
    { wch: 52 },
    { wch: 42 },
    { wch: 55 },
    { wch: 55 },
    { wch: 10 },
    { wch: 28 },
  ];
  return { name, ws };
}

function platformSheet() {
  const ws = XLSX.utils.aoa_to_sheet(PLATFORM_REFERENCE);
  ws['!cols'] = [{ wch: 22 }, { wch: 55 }, { wch: 45 }];
  return { name: 'Platform', ws };
}

const wb = XLSX.utils.book_new();
const sheets = [
  platformSheet(),
  sheet('Functional Test Cases', functional),
  sheet('UI Test Cases', ui),
  sheet('Negative Test Cases', negative),
];

for (const { name, ws } of sheets) {
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

const outDir = path.join(__dirname, '..', '..', 'test-cases');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'Message-Approve-And-Image-Thumbnail-TestCases.xlsx');
XLSX.writeFile(wb, outPath);

console.log('Created:', outPath);
console.log('Functional:', functional.length, '| UI:', ui.length, '| Negative:', negative.length);
console.log('Total test cases:', functional.length + ui.length + negative.length);
