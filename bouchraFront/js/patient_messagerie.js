// ============================================
// PATIENT MESSAGERIE - Simple & Clean
// ============================================
(function () {

    let conversations = [];
    let currentChat = null;
    let conversationsSignature = '';
    let currentMessagesSignature = '';
    let currentMessages = [];
    let currentMessageIds = new Set();
    let patientMessagingSocket = null;
    let patientMessagingSocketBound = false;
    let chatHistoryPushed = false;

    async function init() {
        if (!isLoggedIn()) {
            window.location.href = 'auth.html';
            return;
        }

        if (getUserType() !== 'patient') {
            redirectByUserType(getUserType());
            return;
        }
        // Check VIP access
        try {
            const status = await appointmentAPI.getUrgentAccessStatus();
            if (!status.isActive) {
                showVipGate();
                return;
            }
        } catch (e) {
            showVipGate();
            return;
        }

        // Load user name
        const user = getCurrentUser();
        if (user) {
            const name = user.fullname || user.email || '';
            document.querySelectorAll('.user-name').forEach(el => el.textContent = name);
        }

        // Check for pre-selected doctor from psychologue page
        const preSelectedId = localStorage.getItem('selectedDoctorId');
        const preSelectedName = localStorage.getItem('selectedDoctorName');
        localStorage.removeItem('selectedDoctorId');
        localStorage.removeItem('selectedDoctorName');

        // Load conversations
        await loadConversations();
        updateUnreadBadgeFromState();

        connectMessagingRealtime();

        window.addEventListener('popstate', () => {
            if (document.body.classList.contains('chat-open')) {
                closeChatViewInternal(true);
            }
        });

        // Open pre-selected conversation if exists
        if (preSelectedId) {
            const conv = conversations.find(c => c.partner?.id === preSelectedId);
            if (conv) {
                openChat(conv);
            } else if (preSelectedName) {
                startNewChat(preSelectedId, preSelectedName);
            }
        }

        highlightCurrentSidebarLink();
    }
    function showVipGate() {
        const main = document.querySelector('.main-content');
        if (!main) return;
        main.innerHTML = `
        <header class="page-header">
            <div>
                <h1>Messagerie</h1>
                <p class="breadcrumb">Accueil › Messagerie</p>
            </div>
        </header>
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 20px;text-align:center;background:white;border-radius:16px;border:1px solid #e8ecf4;margin-top:20px;">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#c5b4e4" stroke-width="1.5">
                <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
            </svg>
            <h2 style="margin:20px 0 10px;color:#091346;font-size:22px;">Messagerie VIP</h2>
            <p style="color:#64748b;max-width:380px;line-height:1.6;">La messagerie directe avec les psychologues est réservée aux patients ayant un accès VIP actif.</p>
            <button onclick="showPaymentModal()" style="margin-top:24px;background:#c5b4e4;color:white;padding:13px 28px;border-radius:10px;border:none;font-weight:700;font-size:14px;cursor:pointer;">
                Activer l'accès VIP — 1 000 DA
            </button>
        </div>
    `;
    }

    function showPaymentModal() {
        const existing = document.getElementById('vipPaymentModal');
        if (existing) { existing.style.display = 'flex'; return; }

        const modal = document.createElement('div');
        modal.id = 'vipPaymentModal';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;';
        modal.innerHTML = `
        <div style="background:white;border-radius:16px;padding:32px;max-width:420px;width:90%;text-align:center;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <h2 style="margin:0;color:#091346;font-size:18px;">Activer l'accès VIP</h2>
                <button onclick="document.getElementById('vipPaymentModal').remove()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#666;">&times;</button>
            </div>
            <div style="background:#f3effe;border-radius:10px;padding:16px;margin-bottom:20px;">
                <div style="font-size:28px;font-weight:800;color:#c5b4e4;">1 000 DA</div>
                <div style="font-size:13px;color:#64748b;margin-top:4px;">Accès valide 30 jours</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:12px;text-align:left;">
                <div>
                    <label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px;">Numéro CCP</label>
                    <input type="text" id="vipCcpNumber" placeholder="1234 5678 9012 3456" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div>
                        <label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px;">Date d'expiration</label>
                        <input type="month" id="vipExpDate" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px;">CVV</label>
                        <input type="password" id="vipCvv" maxlength="3" placeholder="123" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;">
                    </div>
                </div>
                <button onclick="processVipPayment()" style="width:100%;padding:14px;background:#c5b4e4;color:white;border:none;border-radius:10px;font-weight:700;font-size:15px;cursor:pointer;margin-top:4px;">
                    Payer et activer
                </button>
            </div>
        </div>
    `;

        document.body.appendChild(modal);
        modal.addEventListener('click', function (e) {
            if (e.target === modal) modal.remove();
        });
    }
    async function processVipPayment() {
        const ccp = document.getElementById('vipCcpNumber')?.value;
        const cvv = document.getElementById('vipCvv')?.value;

        if (!ccp || !cvv) {
            showToast('Veuillez remplir tous les champs', 'error');
            return;
        }

        const btn = document.querySelector('#vipPaymentModal button:last-child');
        if (btn) { btn.textContent = 'Traitement...'; btn.disabled = true; }

        try {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await appointmentAPI.activateUrgentAccess();

            showToast('Accès VIP activé! Accès valide 30 jours.', 'success');
            document.getElementById('vipPaymentModal')?.remove();

            // Reload page to show messagerie
            window.location.reload();

        } catch (error) {
            showToast('Erreur lors du paiement', 'error');
            if (btn) { btn.textContent = 'Payer et activer'; btn.disabled = false; }
        }
    }

    window.showPaymentModal = showPaymentModal;
    window.processVipPayment = processVipPayment;
    async function loadConversations() {
        const listEl = document.querySelector('.conversations-list');

        try {
            const nextConversations = await messageAPI.getConversations() || [];
            const nextSignature = nextConversations.map(c => `${c.partner?.id}:${c.lastMessageTime || ''}:${c.lastMessage || ''}:${c.unreadCount || 0}`).join('|');
            conversations = nextConversations;

            if (nextSignature === conversationsSignature && listEl.dataset.loaded === '1') {
                return false;
            }

            conversationsSignature = nextSignature;
        } catch (e) {
            console.error(e);
            conversations = [];
            conversationsSignature = '';
        }

        if (conversations.length === 0) {
            listEl.innerHTML = `
            <div class="empty-conversations">
                <div class="empty-icon">💬</div>
                <p>Aucune conversation</p>
            </div>
        `;
            listEl.dataset.loaded = '1';
            return true;
        }

        listEl.innerHTML = conversations.map(c => renderConversationItem(c)).join('');
        listEl.dataset.loaded = '1';

        if (currentChat?.partner?.id) {
            document.querySelector(`.conversation-item[data-id="${currentChat.partner.id}"]`)?.classList.add('active');
        }

        return true;
    }

    function openChatById(userId) {
        const conv = conversations.find(c => c.partner?.id === userId);
        if (conv) openChat(conv);
    }

    async function openChat(conv) {
        currentChat = conv;
        currentMessagesSignature = '';
        currentMessages = [];
        currentMessageIds = new Set();
        enterChatView();
        const userId = conv.partner?.id;
        const userName = conv.partner?.fullname || 'Utilisateur';
        const avatarHtml = renderAvatarMarkup(conv.partner, 40, '18px');

        // Update UI
        document.querySelectorAll('.conversation-item').forEach(el => el.classList.remove('active'));
        document.querySelector(`.conversation-item[data-id="${userId}"]`)?.classList.add('active');

        // Show chat area
        const area = document.querySelector('.conversation-area');
        area.innerHTML = `
        <div class="chat-header">
            <div class="chat-user">
                <button class="chat-back-btn" type="button" onclick="closeChatView()" aria-label="Retour">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
                ${avatarHtml}
                <span class="name">${escapeHtml(userName)}</span>
            </div>
        </div>
        <div class="chat-messages" id="chatMessages">
            <div class="loading">Chargement...</div>
        </div>
        <div class="chat-input">
            <input type="text" id="msgInput" placeholder="Tapez votre message..." onkeypress="if(event.key==='Enter')sendMsg()">
            <button class="send-btn" onclick="sendMsg()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
        </div>
    `;

        // Load messages
        try {
            const messages = await messageAPI.getWithUser(userId) || [];
            renderMessages(messages, userId);
            markConversationRead(userId);
        } catch (e) {
            console.error(e);
            document.getElementById('chatMessages').innerHTML = '<div class="empty-state" style="padding: 40px;">Erreur de chargement</div>';
        }
    }

    function renderMessages(messages, partnerId) {
        const user = getCurrentUser();
        const currentUserId = user?.id;
        const container = document.getElementById('chatMessages');
        const nextSignature = messages.map(m => `${m.id}:${m.createdAt}`).join('|');

        if (nextSignature === currentMessagesSignature) {
            return;
        }

        currentMessagesSignature = nextSignature;
        currentMessages = messages.slice();
        currentMessageIds = new Set(messages.map(m => m.id));

        if (!messages.length) {
            container.innerHTML = '<div class="empty-state">Commencez la conversation !</div>';
            return;
        }

        container.innerHTML = messages.map(m => {
            const isMe = m.senderId === currentUserId;
            return `
            <div class="msg ${isMe ? 'sent' : 'received'}">
                <div class="msg-bubble">${escapeHtml(m.content)}</div>
                <div class="msg-time">${formatTime(m.createdAt)}</div>
            </div>
        `;
        }).join('');

        container.scrollTop = container.scrollHeight;
    }

    async function sendMsg() {
        const input = document.getElementById('msgInput');
        const content = input.value.trim();

        if (!content || !currentChat) return;

        input.value = '';

        try {
            const socket = connectMessagingRealtime();
            if (socket) {
                await sendMessageRealtime(currentChat.partner?.id, content);
            } else {
                await messageAPI.send(currentChat.partner?.id, content);
                await loadConversations();
            }
        } catch (e) {
            console.error(e);
            showToast('Erreur: ' + e.message, 'error');
        }
    }

    function startNewChat(doctorId, doctorName) {
        currentChat = { partner: { id: doctorId, fullname: doctorName } };
        enterChatView();

        const area = document.querySelector('.conversation-area');
        area.innerHTML = `
        <div class="chat-header">
            <div class="chat-user">
                <button class="chat-back-btn" type="button" onclick="closeChatView()" aria-label="Retour">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
                ${renderAvatarMarkup(currentChat.partner, 40, '18px')}
                <span class="name">${escapeHtml(doctorName)}</span>
            </div>
        </div>
        <div class="chat-messages" id="chatMessages">
            <div class="empty-state">Nouvelle conversation avec ${escapeHtml(doctorName)}</div>
        </div>
        <div class="chat-input">
            <input type="text" id="msgInput" placeholder="Tapez votre message..." onkeypress="if(event.key==='Enter')sendMsg()">
            <button class="send-btn" onclick="sendMsg()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
        </div>
    `;
    }

    async function loadCurrentThread() {
        if (!currentChat?.partner?.id) return;
        const messages = await messageAPI.getWithUser(currentChat.partner.id) || [];
        renderMessages(messages, currentChat.partner.id);
    }

    function closeChatView() {
        closeChatViewInternal(false);
    }

    function enterChatView() {
        document.body.classList.add('chat-open');

        if (window.matchMedia('(max-width: 900px)').matches && !chatHistoryPushed) {
            window.history.pushState({ chatView: true }, '');
            chatHistoryPushed = true;
        }
    }

    function closeChatViewInternal(fromPopState) {
        document.body.classList.remove('chat-open');

        if (!fromPopState && chatHistoryPushed && window.matchMedia('(max-width: 900px)').matches) {
            chatHistoryPushed = false;
            window.history.back();
            return;
        }

        chatHistoryPushed = false;
    }

    function connectMessagingRealtime() {
        if (!patientMessagingSocket && typeof connectMessagingSocket === 'function') {
            patientMessagingSocket = connectMessagingSocket();
        }

        if (patientMessagingSocket && !patientMessagingSocketBound) {
            patientMessagingSocketBound = true;
            patientMessagingSocket.on('message:new', handleRealtimeMessage);
        }

        return patientMessagingSocket;
    }

    function sendMessageRealtime(receiverId, content) {
        return new Promise((resolve, reject) => {
            const socket = connectMessagingRealtime();
            if (!socket) {
                reject(new Error('Messaging socket unavailable'));
                return;
            }

            const clientMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            socket.emit('message:send', { receiverId, content, clientMessageId }, (response) => {
                if (response?.error) {
                    reject(new Error(response.error));
                    return;
                }
                resolve(response?.message || null);
            });
        });
    }

    function handleRealtimeMessage(payload) {
        const message = payload?.message || payload;
        if (!message?.id) return;

        const currentUserId = getCurrentUser()?.id;
        const partnerId = message.senderId === currentUserId ? message.receiverId : message.senderId;
        if (!partnerId) return;

        upsertConversationFromMessage(message, partnerId);

        if (currentChat?.partner?.id === partnerId) {
            appendMessageToThread(message);
            markConversationRead(partnerId);
        }
    }

    function appendMessageToThread(message) {
        const container = document.getElementById('chatMessages');
        const currentUserId = getCurrentUser()?.id;
        if (!container || !message?.id || currentMessageIds.has(message.id)) return;

        currentMessages.push(message);
        currentMessageIds.add(message.id);
        currentMessagesSignature = currentMessages.map(m => `${m.id}:${m.createdAt}`).join('|');

        const isMe = message.senderId === currentUserId;
        const wrapper = document.createElement('div');
        wrapper.className = `msg ${isMe ? 'sent' : 'received'}`;
        wrapper.innerHTML = `
        <div class="msg-bubble">${escapeHtml(message.content || '')}</div>
        <div class="msg-time">${formatTime(message.createdAt)}</div>
    `;

        container.appendChild(wrapper);
        container.scrollTop = container.scrollHeight;
    }

    function upsertConversationFromMessage(message, partnerId) {
        const currentUserId = getCurrentUser()?.id;
        const partner = message.senderId === currentUserId ? message.receiver : message.sender;
        if (!partner) return;

        const existing = conversations.find(conv => conv.partner?.id === partnerId);
        const nextConversation = {
            partner: {
                id: partner.id,
                fullname: partner.fullname,
                userType: partner.userType || existing?.partner?.userType,
                profile: partner.profile || existing?.partner?.profile || null
            },
            lastMessage: message.content,
            lastMessageTime: message.createdAt,
            unreadCount: message.senderId === currentUserId ? 0 : (currentChat?.partner?.id === partnerId ? 0 : (existing?.unreadCount || 0) + 1)
        };

        conversations = [nextConversation, ...conversations.filter(conv => conv.partner?.id !== partnerId)];
        renderOrMoveConversationItem(nextConversation, currentChat?.partner?.id === partnerId);
    }

    function renderOrMoveConversationItem(conversation, isActive = false) {
        const listEl = document.querySelector('.conversations-list');
        if (!listEl || !conversation?.partner?.id) return;

        const temp = document.createElement('div');
        temp.innerHTML = renderConversationItem(conversation).trim();
        const item = temp.firstElementChild;
        if (!item) return;

        if (isActive) item.classList.add('active');

        const existing = listEl.querySelector(`.conversation-item[data-id="${conversation.partner.id}"]`);
        if (existing) {
            existing.replaceWith(item);
        } else {
            listEl.prepend(item);
        }
    }

    function markConversationRead(partnerId) {
        const conversation = conversations.find(conv => conv.partner?.id === partnerId);
        if (!conversation) return;

        conversation.unreadCount = 0;
        renderOrMoveConversationItem(conversation, true);
        updateUnreadBadgeFromState();
    }

    function updateUnreadBadgeFromState() {
        const badge = document.querySelector('.nav-item[href="patient_messagerie.html"] .badge');
        if (!badge) return;
        const count = conversations.reduce((total, conv) => total + (conv.unreadCount || 0), 0);
        badge.textContent = String(count);
    }

    function renderConversationItem(c) {
        const partner = c.partner || {};
        const name = partner.fullname || 'Utilisateur';

        return `
        <div class="conversation-item" data-id="${partner.id}" onclick="openChatById('${partner.id}')">
            <div class="conv-avatar">${renderAvatarMarkup(partner, 48, '20px')}</div>
            <div class="conv-details">
                <div class="conv-name">${escapeHtml(name)}</div>
                <div class="conv-preview">${escapeHtml(c.lastMessage || 'Aucun message')}</div>
            </div>
            <div class="conv-time">${formatTime(c.lastMessageTime)}</div>
        </div>
    `;
    }

    function renderAvatarMarkup(userLike, size, fontSize) {
        const avatarUrl = getUserAvatarUrl(userLike);
        const name = userLike?.fullname || userLike?.name || userLike?.email || '';
        const initial = (name.trim().charAt(0) || '?').toUpperCase();

        if (avatarUrl) {
            return `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;display:block;">`;
        }

        return `<div style="width:${size}px;height:${size}px;background: linear-gradient(135deg, var(--primary-green), #2F8F83);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${fontSize};font-weight:700;color:white;flex-shrink:0;">${escapeHtml(initial)}</div>`;
    }

    function getUserAvatarUrl(userLike) {
        return userLike?.profile?.avatar || userLike?.avatar || userLike?.photo || userLike?.image || userLike?.profileImage || userLike?.picture || null;
    }

    function formatTime(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        const now = new Date();
        const diff = Math.floor((now - d) / (1000 * 60 * 60 * 24));

        if (diff === 0) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        if (diff === 1) return 'Hier';
        if (diff < 7) return d.toLocaleDateString('fr-FR', { weekday: 'short' });
        return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    async function updateUnreadBadge() {
        try {
            const result = await messageAPI.getUnreadCount().catch(() => null);
            const count = result?.unreadCount || 0;
            const badge = document.querySelector('.nav-item[href="patient_messagerie.html"] .badge');
            if (badge) badge.textContent = count;
        } catch (e) { }
    }

    // Expose functions globally
    window.openChatById = openChatById;
    window.sendMsg = sendMsg;
    window.closeChatView = closeChatView;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
