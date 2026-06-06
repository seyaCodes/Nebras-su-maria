(function () {

    let isVIP = false;
    let selectedOffer = null;
    let selectedOfferElement = null;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadVipData);
    } else {
        loadVipData();
    }

    async function loadVipData() {
        try {
            const data = await doctorAPI.getVipStatus();

            isVIP = data.isVIP;
            updateVIPStatus(data.isVIP);

            if (data.form && data.form.questions && data.form.questions.length > 0) {
                renderQuestions(data.form.questions.map(q => q.text));
            } else {
                renderQuestions(['']);
            }

            if (!isVIP) {
                setTimeout(function () {
                    openVipPaymentModal();
                }, 500);
            }

            updateSidebarBadge();

        } catch (error) {
            console.error('Error loading VIP data:', error);
            showToast('Erreur lors du chargement des données VIP', 'error');
        }
    }

    // ============================================
    // DYNAMIC QUESTION BUILDER
    // ============================================
    function renderQuestions(questions) {
        const container = document.getElementById('questionsContainer');
        if (!container) return;

        container.innerHTML = '';
        questions.forEach((text, index) => {
            container.appendChild(createQuestionRow(index + 1, text));
        });
    }

    function createQuestionRow(number, text) {
        const row = document.createElement('div');
        row.className = 'question-row';
        row.innerHTML = `
            <div class="question-row-header">
                <span class="question-number">Question <span class="q-num">${number}</span></span>
                <button type="button" class="btn-remove-question" onclick="removeQuestion(this)" title="Supprimer">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <input type="text" class="vip-input question-input"
                   placeholder="Entrez votre question ici..."
                   value="${escapeAttr(text)}">
        `;
        return row;
    }

    function updateQuestionNumbers() {
        document.querySelectorAll('.question-row').forEach((row, index) => {
            const numEl = row.querySelector('.q-num');
            if (numEl) numEl.textContent = index + 1;
        });
    }

    function addQuestion() {
        const container = document.getElementById('questionsContainer');
        if (!container) return;
        const count = container.querySelectorAll('.question-row').length;
        container.appendChild(createQuestionRow(count + 1, ''));
        // Focus the new input
        const inputs = container.querySelectorAll('.question-input');
        inputs[inputs.length - 1]?.focus();
    }

    function removeQuestion(btn) {
        const container = document.getElementById('questionsContainer');
        if (container.querySelectorAll('.question-row').length <= 1) {
            showToast('Au moins une question est requise', 'error');
            return;
        }
        btn.closest('.question-row').remove();
        updateQuestionNumbers();
    }

    function escapeAttr(text) {
        return (text || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ============================================
    // SAVE FORM
    // ============================================
    async function saveVipForm() {
        if (!isVIP) {
            showToast('Vous devez d\'abord activer votre compte VIP pour créer le formulaire.', 'error');
            openVipPaymentModal();
            return;
        }

        const inputs = document.querySelectorAll('.question-input');
        const questions = Array.from(inputs)
            .map(input => input.value.trim())
            .filter(q => q.length > 0);

        if (questions.length === 0) {
            showToast('Veuillez entrer au moins une question', 'error');
            return;
        }

        const saveBtn = document.querySelector('.update-btn');
        const originalText = saveBtn?.textContent || 'Enregistrer';
        if (saveBtn) {
            saveBtn.textContent = 'Enregistrement...';
            saveBtn.disabled = true;
        }

        try {
            await doctorAPI.saveVipForm({ questions });
            showToast('Formulaire VIP enregistré ! Vos patients pourront le remplir avant chaque séance.', 'success');
        } catch (error) {
            console.error('Error saving VIP form:', error);
            showToast(error.message || 'Erreur lors de l\'enregistrement du formulaire', 'error');
        } finally {
            if (saveBtn) {
                saveBtn.textContent = originalText;
                saveBtn.disabled = false;
            }
        }
    }

    // ============================================
    // VIP STATUS
    // ============================================
    function updateVIPStatus(active) {
        const badge = document.getElementById('vipStatusBadge');
        if (!badge) return;
        if (active) {
            badge.innerText = 'Activé';
            badge.classList.add('actif');
        } else {
            badge.innerText = 'Non activé';
            badge.classList.remove('actif');
        }
    }

    function updateSidebarBadge() {
        const sidebarBadges = document.querySelectorAll('.nav-item .badge');
        sidebarBadges.forEach(badge => {
            if (badge && badge.nextSibling && badge.nextSibling.textContent.includes('Espace VIP')) {
                badge.innerText = isVIP ? 'VIP' : '';
            }
        });
    }

    function openVipPaymentModal() {
        document.getElementById('vipPaymentModal').classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeVipPaymentModal() {
        document.getElementById('vipPaymentModal').classList.remove('active');
        document.body.style.overflow = 'auto';
    }

    function selectVipOffer(element, offer) {
        if (selectedOfferElement) {
            selectedOfferElement.classList.remove('selected');
        }
        element.classList.add('selected');
        selectedOfferElement = element;
        selectedOffer = offer;
    }

    async function activateVIP() {
        const ccp = document.getElementById('ccpNumber').value;
        const expDate = document.getElementById('expDate').value;
        const cvv = document.getElementById('cvv').value;

        if (!ccp || !expDate || !cvv) {
            showToast('Veuillez remplir tous les champs', 'error');
            return;
        }
        if (!selectedOffer) {
            showToast('Veuillez choisir une offre', 'error');
            return;
        }

        try {
            await doctorAPI.activateVip(selectedOffer, ccp);

            const role = getUserType();
            showToast('Paiement réussi ! Vous êtes maintenant ' + role + ' VIP.', 'success');
            isVIP = true;
            updateVIPStatus(true);
            updateSidebarBadge();
            closeVipPaymentModal();

            document.getElementById('ccpNumber').value = '';
            document.getElementById('expDate').value = '';
            document.getElementById('cvv').value = '';
            selectedOffer = null;
            if (selectedOfferElement) {
                selectedOfferElement.classList.remove('selected');
                selectedOfferElement = null;
            }

            // Start with one empty question after VIP activation
            renderQuestions(['']);

        } catch (error) {
            console.error('Error activating VIP:', error);
            showToast(error.message || 'Erreur lors de l\'activation du VIP', 'error');
        }
    }

    // ============================================
    // EVENTS
    // ============================================
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeVipPaymentModal();
    });

    document.querySelectorAll('.nav-menu .nav-item').forEach(link => {
        link.addEventListener('click', function () {
            sessionStorage.setItem('menuScrollPos', document.querySelector('.nav-menu').scrollTop);
        });
    });

    window.addEventListener('load', function () {
        const scrollPos = sessionStorage.getItem('menuScrollPos');
        if (scrollPos) {
            document.querySelector('.nav-menu').scrollTop = scrollPos;
        }
    });

    if (typeof loadPublicSettings === 'function') {
        loadPublicSettings().then(s => {
            if (s?.vipMonthlyPrice) {
                const monthly = document.querySelector('.vip-offer:first-child .price');
                const annual = document.querySelector('.vip-offer:last-child .price');
                if (monthly) monthly.textContent = Number(s.vipMonthlyPrice).toLocaleString() + ' DA';
                if (annual) annual.textContent = Number(s.vipMonthlyPrice * 12 * 0.833).toLocaleString() + ' DA';
            }
        }).catch(() => { });
    }

    window.closeVipPaymentModal = closeVipPaymentModal;
    window.openVipPaymentModal = openVipPaymentModal;
    window.selectVipOffer = selectVipOffer;
    window.activateVIP = activateVIP;
    window.saveVipForm = saveVipForm;
    window.addQuestion = addQuestion;
    window.removeQuestion = removeQuestion;
})();