// ============================================
// PATIENT CALL LISTENER (Shared across all patient pages)
// ============================================
(function () {

    window.PatientCallState = {
        currentDoctorId: null,
        activeCallData: null,
        callStatus: null
    };

    let callCheckInterval = null;
    let lastCallActive = false;
    let lastCallStatus = null;
    let patientCallListenerInitialized = false;
    let sessionSocket = null;
    const callPollIntervalMs = 2000;
    let callStatusRequestInFlight = false;
    const socketUrl = window.API_URL.replace('/api', '');

    // Rating deduplication — prevents showing the group rating modal more than once per session
    function getSessionRatingKey(groupId, doctorId) {
        const user = getCurrentUser();
        const patientId = user?.id || 'unknown';
        return `group_rated_${groupId}_${doctorId}_${patientId}`;
    }

    function isSessionRated(groupId, doctorId) {
        return !!sessionStorage.getItem(getSessionRatingKey(groupId, doctorId));
    }

    function markSessionRated(groupId, doctorId) {
        sessionStorage.setItem(getSessionRatingKey(groupId, doctorId), '1');
    }

    let urgentPaymentPollInterval = null;

    function initPatientCallListener() {
        if (patientCallListenerInitialized) return;
        patientCallListenerInitialized = true;

        const userType = typeof getUserType === 'function'
            ? getUserType()
            : localStorage.getItem('userType');

        if (userType !== 'patient') return;

        // Initialize Socket.io for real-time updates
        initSessionSocket();

        // Start polling as initial fallback (stopped if socket connects)
        startCallPolling();
        window.addEventListener('storage', handleStorageChange);

        checkCallStatus();

        // Poll for urgent payment status as a reliable fallback to the socket event
        checkPendingUrgentPayment();
        urgentPaymentPollInterval = setInterval(checkPendingUrgentPayment, 5000);
    }

    async function checkPendingUrgentPayment() {
        const pendingId = localStorage.getItem('pendingUrgentPaymentId');
        if (!pendingId) return;

        // Don't re-show if modal is already visible
        if (document.getElementById('urgentPaymentModal')) return;

        try {
            const requests = await appointmentAPI.getUrgentRequests();
            const list = Array.isArray(requests) ? requests : [];
            const match = list.find(r => r.id === pendingId && r.status === 'accepted');
            if (match) {
                showUrgentPaymentModal({
                    urgentId: match.id,
                    amount: match.amount || 2000,
                    doctorName: match.doctor?.fullname || 'le praticien'
                });
            } else if (list.find(r => r.id === pendingId && (r.status === 'in_call' || r.status === 'rejected' || r.status === 'completed'))) {
                // Request is no longer waiting — stop polling
                localStorage.removeItem('pendingUrgentPaymentId');
            }
        } catch (e) {
            // Silent fail — polling is a background fallback
        }
    }

    function initSessionSocket() {
        if (sessionSocket) return;

        const user = getCurrentUser();
        if (!user || !user.id) return;

        // Check if socket.io is available
        if (typeof io !== 'undefined') {
            const token = localStorage.getItem('nebras_token');
            if (!token) return;

            sessionSocket = io(socketUrl, {
                transports: ['websocket', 'polling'],
                auth: { token },
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000
            });

            sessionSocket.on('connect', () => {
                console.log('Session socket connected');
                // Join patient room for real-time events
                sessionSocket.emit('join-patient-room', user.id);
                // Stop polling — socket provides real-time updates
                if (callCheckInterval) {
                    clearInterval(callCheckInterval);
                    callCheckInterval = null;
                }
            });

            sessionSocket.on('session-started', (data) => {
                console.log('Real-time session started event:', data);
                window.PatientCallState.currentDoctorId = data.doctorId;
                window.PatientCallState.activeCallData = data;
                localStorage.setItem('currentDoctorId', data.doctorId);
                checkCallStatus();
            });

            sessionSocket.on('session-ended', (data) => {
                console.log('Real-time session ended event:', data);
                window.PatientCallState.currentDoctorId = null;
                window.PatientCallState.activeCallData = null;
                localStorage.removeItem('currentDoctorId');

                if (lastCallActive) {
                    handleCallEnded();
                }
                lastCallActive = false;
                lastCallStatus = null;

                const callEntry = document.getElementById('patientCallEntry');
                if (callEntry) callEntry.remove();
            });

            // Doctor accepted patient into the group call
            sessionSocket.on('group:join-accepted', (data) => {
                console.log('Group join accepted:', data);
                if (typeof showToast === 'function') {
                    showToast('Vous avez été accepté dans le groupe', 'success');
                }
                sessionStorage.setItem('groupCallRoom', data.roomId);
                sessionStorage.setItem('groupCallGroupId', data.groupId);
                sessionStorage.setItem('groupCallDoctorId', data.doctorId);
                sessionStorage.setItem('groupCallDoctorName', data.doctorName || 'Psychologue');
                showGroupCallEntry(data);
            });

            // Doctor rejected patient's group join request
            sessionSocket.on('group:join-rejected', (data) => {
                console.log('Group join rejected:', data);
                if (typeof showToast === 'function') {
                    showToast('Votre demande d\'adhésion au groupe a été refusée', 'error');
                }
                window.dispatchEvent(new CustomEvent('grouptherapy:data-changed', { detail: data }));
            });

            // Group session ended
            sessionSocket.on('group:ended', (data) => {
                console.log('Group ended:', data);
                window.removeGroupCallEntry();
                if (!isSessionRated(data.groupId, data.doctorId)) {
                    try {
                        sessionStorage.setItem('pendingGroupRating', JSON.stringify({
                            doctorId: data.doctorId,
                            doctorName: data.doctorName || 'Psychologue',
                            groupId: data.groupId
                        }));
                    } catch (e) { }
                }
                if (data.disconnect) {
                    if (typeof showToast === 'function') {
                        showToast('La session de groupe est terminée', 'info');
                    }
                    sessionStorage.removeItem('groupCallRoom');
                    sessionStorage.removeItem('groupCallGroupId');
                    sessionStorage.removeItem('groupCallDoctorId');
                }
                if (typeof handleGroupSessionEnded === 'function') {
                    handleGroupSessionEnded(data);
                }
                window.dispatchEvent(new CustomEvent('grouptherapy:session-ended', { detail: data }));
            });

            // Group data changed
            sessionSocket.on('group-data-changed', (data) => {
                console.log('Group data changed:', data);
                window.dispatchEvent(new CustomEvent('grouptherapy:data-changed', { detail: data }));
            });

            // Doctor accepted urgent request — patient must pay
            sessionSocket.on('paymentRequired', (data) => {
                console.log('Payment required:', data);
                showUrgentPaymentModal(data);
            });

            // Payment confirmed — call is ready for both sides
            sessionSocket.on('callReady', (data) => {
                console.log('Call ready:', data);
                hideUrgentPaymentModal();
                if (typeof showToast === 'function') {
                    showToast('Paiement confirmé ! L\'appel démarre...', 'success');
                }
                checkCallStatus();
                setTimeout(function () {
                    if (data.appointmentId) {
                        window.location.href = 'video-call.html?room=' + data.roomId + '&appointment=' + data.appointmentId + '&type=patient';
                    }
                }, 1500);
            });

            sessionSocket.on('disconnect', () => {
                console.log('Session socket disconnected');
                startCallPolling();
            });

            sessionSocket.on('connect_error', (error) => {
                console.log('❌ Session socket connection error:', error.message);
            });
        } else {
            console.log('Socket.io not available, using polling only');
        }
    }

    function startCallPolling() {
        if (callCheckInterval) clearInterval(callCheckInterval);
        callCheckInterval = setInterval(() => {
            checkCallStatus();
        }, 5000);
    }

    function handleStorageChange(event) {
        if (event.key === 'doctorInCall' || event.key === 'currentCallAppointment' || event.key === 'nebras_user') {
            checkCallStatus();
        }
    }

    async function checkCallStatus() {
        if (callStatusRequestInFlight) return;

        try {
            callStatusRequestInFlight = true;
            let status = null;

            if (appointmentAPI?.getMyCallStatus) {
                status = await appointmentAPI.getMyCallStatus();
            } else if (appointmentAPI?.getCallStatus && window.PatientCallState.currentDoctorId) {
                status = await appointmentAPI.getCallStatus(window.PatientCallState.currentDoctorId);
            } else if (doctorAPI?.getCallStatus && window.PatientCallState.currentDoctorId) {
                status = await doctorAPI.getCallStatus(window.PatientCallState.currentDoctorId);
            }

            if (status) updateCallEntryUI(status);
        } catch (error) {
            console.log('Call status check failed');
        } finally {
            callStatusRequestInFlight = false;
        }
    }

    function updateCallEntryUI(status) {
        let callEntry = document.getElementById('patientCallEntry');

        if (status.inCall && status.appointmentId) {
            lastCallActive = true;
            lastCallStatus = status;

            if (status.doctorId) {
                window.PatientCallState.currentDoctorId = status.doctorId;
                localStorage.setItem('currentDoctorId', status.doctorId);
            }

            if (!callEntry) {
                callEntry = createCallEntryElement();
                insertCallEntry(callEntry);
            } else {
                ensureCallEntryMarkup(callEntry);
                attachCallEntryEvents(callEntry);
            }
            updateCallEntryContent(callEntry, status);
        } else {
            if (lastCallActive) handleCallEnded();
            if (callEntry) callEntry.remove();
            lastCallActive = false;
            window.PatientCallState.currentDoctorId = null;
            localStorage.removeItem('currentDoctorId');
        }
    }

    function createCallEntryElement() {
        const div = document.createElement('div');
        div.id = 'patientCallEntry';
        div.className = 'call-entry-sidebar';
        div.setAttribute('role', 'button');
        div.setAttribute('tabindex', '0');
        ensureCallEntryMarkup(div);
        attachCallEntryEvents(div);
        return div;
    }

    function ensureCallEntryMarkup(callEntry) {
        const hasIcon = callEntry.querySelector('.call-entry-icon svg');
        if (hasIcon) return;

        callEntry.innerHTML = `
        <div class="call-entry-icon" aria-hidden="true">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                <polygon points="23 7 16 12 23 17 23 7"></polygon>
            </svg>
        </div>
        <div class="call-entry-content">
            <span class="call-entry-title">Appel en cours</span>
            <span class="call-entry-doctor">avec le Psychologue</span>
        </div>
        <button class="call-entry-btn" type="button">Rejoindre</button>
    `;
    }

    function attachCallEntryEvents(callEntry) {
        if (callEntry.dataset.bound === 'true') return;
        callEntry.dataset.bound = 'true';

        callEntry.addEventListener('click', function (event) {
            const btn = event.target.closest('.call-entry-btn');
            if (btn || event.currentTarget === event.target) {
                event.preventDefault();
                joinDoctorCall();
            }
        });

        callEntry.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                joinDoctorCall();
            }
        });
    }

    function insertCallEntry(callEntry) {
        const navMenu = document.querySelector('.nav-menu');
        if (navMenu) {
            const firstItem = navMenu.querySelector('.nav-item');
            if (firstItem) {
                navMenu.insertBefore(callEntry, firstItem);
            } else {
                navMenu.appendChild(callEntry);
            }
            return;
        }

        const sidebar = document.querySelector('.sidebar');
        if (sidebar) sidebar.appendChild(callEntry);
    }

    function updateCallEntryContent(callEntry, status) {
        const doctorName = status.doctorName || 'le Psychologue';
        const doctorEl = callEntry.querySelector('.call-entry-doctor');
        if (doctorEl) doctorEl.textContent = `avec ${doctorName}`;
    }

    // ========== GROUP CALL SIDEBAR ENTRY ==========
    window.showGroupCallEntry = function (data) {
        window.removeGroupCallEntry();

        const safeDoctorName = (data.doctorName || 'Psychologue').replace(/[<>&"]/g, function (c) {
            return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c];
        });
        const joinUrl = `video-call.html?room=${data.roomId || ''}&type=group&groupId=${data.groupId || ''}&doctorId=${data.doctorId || ''}`;

        const invite = document.createElement('div');
        invite.id = 'patientGroupCallInvite';
        invite.className = 'group-call-invite';
        invite.innerHTML = `
        <div class="group-call-invite-card">
            <div class="group-call-invite-head">
                <div class="group-call-dot"></div>
                <strong>Invitation appel de groupe</strong>
            </div>
            <div class="group-call-invite-body">
                <span>${safeDoctorName} vous invite à rejoindre la séance.</span>
            </div>
            <div class="group-call-invite-actions">
                <button type="button" class="group-call-btn group-call-btn-secondary" id="dismissGroupInviteBtn">Plus tard</button>
                <button type="button" class="group-call-btn group-call-btn-primary" id="joinGroupInviteBtn">Rejoindre</button>
            </div>
        </div>
    `;

        document.body.appendChild(invite);
        requestAnimationFrame(() => invite.classList.add('active'));

        const showPill = function () {
            let pill = document.getElementById('patientGroupCallPill');
            if (!pill) {
                pill = document.createElement('button');
                pill.id = 'patientGroupCallPill';
                pill.className = 'group-call-pill';
                pill.type = 'button';
                pill.innerHTML = '<span>Appel de groupe en attente</span>';
                pill.addEventListener('click', function () {
                    window.location.href = joinUrl;
                });
                document.body.appendChild(pill);
            }
        };

        invite.querySelector('#joinGroupInviteBtn')?.addEventListener('click', function () {
            window.location.href = joinUrl;
        });

        invite.querySelector('#dismissGroupInviteBtn')?.addEventListener('click', function () {
            invite.classList.remove('active');
            setTimeout(() => invite.remove(), 180);
            showPill();
        });
    };

    window.removeGroupCallEntry = function () {
        const invite = document.getElementById('patientGroupCallInvite');
        const pill = document.getElementById('patientGroupCallPill');
        if (invite) invite.remove();
        if (pill) pill.remove();
    };

    // ========== URGENT PAYMENT MODAL ==========
    function showUrgentPaymentModal(data) {
        hideUrgentPaymentModal();

        const safeDoctorName = (data.doctorName || 'le praticien').replace(/[<>&"]/g, function (c) {
            return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c];
        });

        const modal = document.createElement('div');
        modal.id = 'urgentPaymentModal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
        modal.innerHTML = `
            <div style="background:#fff;border-radius:16px;padding:32px;max-width:420px;width:92%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
                <h2 style="margin:0 0 8px;color:#1a1a2e;font-size:1.3rem;">Consultation acceptée !</h2>
                <p style="color:#555;margin:0 0 20px;font-size:0.95rem;">
                    <strong>${safeDoctorName}</strong> a accepté votre demande.
                    Veuillez régler la consultation via CCP pour démarrer l'appel.
                </p>
                <div style="background:#eef0f8;border:2px solid #091346;border-radius:10px;padding:16px;margin-bottom:20px;text-align:center;">
                    <div style="font-size:0.85rem;color:#091346;font-weight:600;margin-bottom:4px;">MONTANT À RÉGLER</div>
                    <div style="font-size:2rem;font-weight:800;color:#1a1a2e;">${data.amount || 2000} <span style="font-size:1rem;">DA</span></div>
                </div>
                <div style="background:#fff8e1;border-radius:8px;padding:12px;margin-bottom:20px;font-size:0.85rem;color:#b45309;">
                    <strong>CCP Nebras :</strong> 123 456 789 — Clé 78<br>
                    Indiquez votre numéro de référence CCP ci-dessous.
                </div>
                <input id="urgentCcpInput" type="text" placeholder="N° référence CCP (ex: CCP-123456)"
                    style="width:100%;box-sizing:border-box;padding:12px;border:2px solid #e2e8f0;border-radius:8px;font-size:1rem;margin-bottom:16px;outline:none;"
                    onfocus="this.style.borderColor='#091346'" onblur="this.style.borderColor='#e2e8f0'" />
                <button id="urgentPayBtn"
                    style="width:100%;padding:14px;background:#091346;color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;transition:background 0.2s;"
                    onmouseover="this.style.background='#0d1d5e'" onmouseout="this.style.background='#091346'">
                    Confirmer le paiement &amp; démarrer l'appel
                </button>
                <button id="urgentPayCancelBtn"
                    style="width:100%;padding:10px;background:transparent;color:#888;border:none;font-size:0.9rem;cursor:pointer;margin-top:8px;">
                    Annuler
                </button>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('urgentPayBtn').addEventListener('click', async function () {
            const ccpInput = document.getElementById('urgentCcpInput');
            const ccp = ccpInput ? ccpInput.value.trim() : '';
            const btn = document.getElementById('urgentPayBtn');

            btn.disabled = true;
            btn.textContent = 'Traitement...';

            try {
                const result = await appointmentAPI.payUrgent(data.urgentId, ccp);
                localStorage.removeItem('pendingUrgentPaymentId');
                if (typeof showToast === 'function') {
                    showToast('Paiement enregistré ! L\'appel va démarrer.', 'success');
                }
                hideUrgentPaymentModal();
                if (result && result.roomId) {
                    setTimeout(function () {
                        window.location.href = 'video-call.html?room=' + result.roomId + '&appointment=' + result.appointment.id + '&type=patient';
                    }, 1500);
                }
            } catch (err) {
                btn.disabled = false;
                btn.textContent = 'Confirmer le paiement & démarrer l\'appel';
                if (typeof showToast === 'function') {
                    showToast(err.message || 'Erreur lors du paiement', 'error');
                }
            }
        });

        document.getElementById('urgentPayCancelBtn').addEventListener('click', function () {
            hideUrgentPaymentModal();
        });
    }

    function hideUrgentPaymentModal() {
        const modal = document.getElementById('urgentPaymentModal');
        if (modal) modal.remove();
    }

    window.joinDoctorCall = async function () {
        try {
            let status = lastCallStatus;

            if (!status || !status.inCall) {
                status = appointmentAPI?.getMyCallStatus
                    ? await appointmentAPI.getMyCallStatus()
                    : (window.PatientCallState.currentDoctorId && appointmentAPI?.getCallStatus)
                        ? await appointmentAPI.getCallStatus(window.PatientCallState.currentDoctorId)
                        : null;
            }

            if (status?.inCall && status.appointmentId) {
                const roomId = status.appointmentId;
                window.location.href = `video-call.html?room=${roomId}&appointment=${status.appointmentId}&type=patient`;
                return;
            }

            if (typeof showToast === 'function') {
                showToast('La consultation n\'est plus disponible', 'error');
            }
        } catch (e) {
            console.log('Join call failed:', e);
            if (typeof showToast === 'function') {
                showToast('Impossible de rejoindre la consultation', 'error');
            }
        }
    };

    function handleCallEnded() {
        if (typeof leavePatientSession === 'function') {
            leavePatientSession();
        }

        const activeSessionSection = document.getElementById('activeSessionSection');
        if (activeSessionSection) activeSessionSection.style.display = 'none';

        sessionStorage.removeItem('joinCall');
        sessionStorage.removeItem('joinCallDoctorId');

        if (typeof showToast === 'function') {
            showToast('La consultation est terminee', 'info');
        }

        lastCallStatus = null;
    }

    // Expose for router SPA navigation
    window.initPatientCallListener = initPatientCallListener;
    window.initPage = initPatientCallListener;

    if (typeof module !== 'undefined') module.exports = { initPatientCallListener };

    // Auto-run on first hard load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPatientCallListener);
    } else {
        initPatientCallListener();
    }

})();