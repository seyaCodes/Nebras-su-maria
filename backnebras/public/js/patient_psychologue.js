// ============================================
// PATIENT PSYCHOLOGUE PAGE - Fetch & Display Doctors from Backend
// ============================================
(function () {

    function debounce(fn, delay) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    let doctors = [];
    let userPreferences = null;
    let selectedDoctor = null;
    let urgentActif = false;
    let doctorCache = new Map();
    let urgentTargetDoctorId = null;
    let urgentSelectedTab = 'psychologue';
    let activeTypeFilter = 'all';

    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    const BOOKING_TIME_GROUPS = [
        { key: 'morning', label: 'Matin', startHour: 8, endHour: 11 },
        { key: 'afternoon', label: 'Après-midi', startHour: 12, endHour: 17 },
        { key: 'evening', label: 'Soir', startHour: 18, endHour: 20 }
    ];

    let bookingAvailability = null;
    let bookingAvailabilityRequestId = 0;
    let bookingSelectedTime = '';

    async function initPage() {
        if (!isLoggedIn()) {
            showToast('Veuillez vous connecter d\'abord', 'error');
            window.location.href = 'auth.html';
            return;
        }

        if (getUserType() !== 'patient') {
            redirectByUserType(getUserType());
            return;
        }

        const user = getCurrentUser();
        if (user) {
            const name = user.fullname || user.email || '';
            document.querySelectorAll('.user-name').forEach(el => el.textContent = name);
            const greeting = document.querySelector('.page-header h1');
            if (greeting && greeting.textContent.includes('Bonjour')) {
                greeting.textContent = 'Bonjour, ' + name;
            }
        }

        const [userPrefsResult] = await Promise.all([
            loadUserPreferences(),
            fetchDoctors(),
            checkUrgentAccessStatus()
        ]);
        highlightCurrentSidebarLink();

        // Check URL for joining a call
        const urlParams = new URLSearchParams(window.location.search);
        const joinCall = urlParams.get('joinCall');
        if (joinCall) {
            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        // Init call listener
        if (typeof initPatientCallListener === 'function') {
            setTimeout(initPatientCallListener, 500);
        }
        document.getElementById('bookingDate')?.addEventListener('change', () => {
            if (document.getElementById('bookingModal')?.classList.contains('active')) {
                refreshBookingAvailability();
            }
        });

        const debouncedFilter = debounce(filterPsychologues, 200);
        document.getElementById('searchInput')?.addEventListener('keyup', debouncedFilter);
    }
    async function checkUrgentAccessStatus() {
        try {
            const status = await appointmentAPI.getUrgentAccessStatus();
            if (status.isActive) {
                urgentActif = true;
                document.getElementById('urgentBanner').style.display = 'flex';
                showToast(`URGENT actif! ${status.daysLeft} jour(s) restant(s)`, 'info');
            }
        } catch (error) {
            console.log('Could not load urgent access status');
        }
    }

    async function loadUserPreferences() {
        try {
            const result = await authAPI.getMe();
            if (result.user && result.user.profile) {
                userPreferences = result.user.profile;
            }
        } catch (error) {
            console.error('Error loading user preferences:', error);
        }
    }

    async function fetchDoctors() {
        try {
            const [psyResult, counselorResult] = await Promise.all([
                doctorAPI.getAll({ view: 'summary', role: 'psychologue' }),
                doctorAPI.getAll({ view: 'summary', role: 'counselor' })
            ]);

            const psychologues = (psyResult || []).map(p => ({ ...p, role: 'psychologue' }));
            const counselors = (counselorResult || []).map(c => ({ ...c, role: 'counselor' }));

            doctors = [...psychologues, ...counselors];

            let filtered = doctors;
            if (userPreferences && userPreferences.prefGender) {
                filtered = filterDoctorsByPreferences(filtered);
            }

            renderDoctors(filtered);
        } catch (error) {
            console.error('Error fetching doctors:', error);
            showToast('Erreur lors du chargement', 'error');
        }
    }

    function filterDoctorsByPreferences(doctorsList) {
        let filtered = [...doctorsList];

        if (userPreferences.prefGender && userPreferences.prefGender !== 'indiffere') {
            filtered = filtered.filter(d => {
                const docGender = d.fullname.toLowerCase().includes('dr.') ?
                    (d.fullname.toLowerCase().includes('a') ? 'femme' : 'homme') : null;
                return !docGender || docGender === userPreferences.prefGender;
            });
        }

        if (userPreferences.prefType === 'couple') {
            filtered = filtered.filter(d =>
                d.specialite?.toLowerCase().includes('couple') ||
                d.bio?.toLowerCase().includes('couple')
            );
        } else if (userPreferences.prefType === 'familiale') {
            filtered = filtered.filter(d =>
                d.specialite?.toLowerCase().includes('famille') ||
                d.bio?.toLowerCase().includes('famille')
            );
        }

        return filtered;
    }
    function renderDoctorCard(doctor, roleLabel) {
        const avatarHtml = doctor.avatar
            ? `<img src="${doctor.avatar}" alt="${doctor.fullname}" class="psy-avatar-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">`
            : '';
        const defaultAvatarSvg = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="psy-avatar-default">
            <circle cx="12" cy="8" r="4"/>
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        </svg>
    `;
        const roleDisplayName = roleLabel === 'counselor' ? 'Conseiller' : 'Psychologue';
        const roleBadgeClass = roleLabel === 'counselor' ? 'counselor' : 'psy';

        const urgentBtn = '';

        return `
    <div class="psy-card" 
         data-name="${doctor.fullname.toLowerCase()}" 
         data-online="${doctor.isAvailable}"
         data-role="${roleLabel}"
         onclick="viewDoctor('${doctor.id}')">
        <div class="psy-card-header">
            <div class="psy-avatar-container">
                ${avatarHtml}
                <div class="psy-avatar-default" ${doctor.avatar ? 'style="display:none"' : ''}>
                    ${defaultAvatarSvg}
                </div>
                ${doctor.isAvailable ? '<div class="online-indicator"></div>' : ''}
            </div>
        </div>
        <div class="psy-card-body">
            <h3 class="psy-name">${doctor.fullname}</h3>
            <p class="psy-specialite">${doctor.specialite || 'Général'}</p>
            <span class="psy-role-badge ${roleBadgeClass}">${roleDisplayName}</span>
            <div class="psy-meta">
                <div class="psy-rating">
                    ${'★'.repeat(Math.floor(doctor.rating || 0))}${'☆'.repeat(5 - Math.floor(doctor.rating || 0))}
                    <span class="rating-value">${doctor.rating ? doctor.rating.toFixed(1) : '0'}</span>
                </div>
                <div class="psy-price">${doctor.tarif || 2000} DA</div>
            </div>
        </div>
        <div class="psy-card-footer">
            <button class="psy-view-btn" onclick="event.stopPropagation(); viewDoctor('${doctor.id}')">
                Voir profil
            </button>
            ${urgentBtn}
        </div>
    </div>
    `;
    }

    function renderDoctors(allDoctors) {
        const psyGrid = document.getElementById('psychologuesGrid');
        if (!psyGrid) return;

        if (allDoctors.length === 0) {
            psyGrid.innerHTML = '<div class="no-results"><p>Aucun professionnel ne correspond à vos préférences.</p><p>Modifiez vos préférences dans votre profil pour voir plus de résultats.</p></div>';
        } else {
            psyGrid.innerHTML = allDoctors.map(d => renderDoctorCard(d, d.userType === 'counselor' ? 'counselor' : 'psychologue')).join('');
        }

        const resultEl = document.getElementById('resultCount');
        if (resultEl) {
            const total = allDoctors.length;
            resultEl.textContent = `${total} professionnel${total > 1 ? 's' : ''} disponible${total > 1 ? 's' : ''}`;
        }
    }

    function getNextAvailableSlot(slots) {
        if (!slots || slots.length === 0) return null;

        const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
        const today = new Date();

        for (let i = 1; i <= 7; i++) {
            const checkDate = new Date(today);
            checkDate.setDate(today.getDate() + i);
            const dayOfWeek = checkDate.getDay();

            const hasSlot = slots.some(slot => slot.dayOfWeek === dayOfWeek);
            if (hasSlot) {
                return checkDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'numeric' });
            }
        }
        return null;
    }

    function getSlotHour(time) {
        if (!time) return null;
        const [hour] = String(time).split(':');
        const parsed = Number.parseInt(hour, 10);
        return Number.isNaN(parsed) ? null : parsed;
    }

    function getSlotPeriod(time) {
        const hour = getSlotHour(time);
        if (hour === null) return 'other';
        if (hour < 12) return 'morning';
        if (hour < 18) return 'afternoon';
        return 'evening';
    }

    function formatBookingSlotRange(slot) {
        if (!slot) return '';
        if (slot.endTime && slot.endTime !== slot.startTime) {
            return `${slot.startTime} - ${slot.endTime}`;
        }
        return slot.startTime || '';
    }

    function updateBookingSelectedLabel() {
        const label = document.getElementById('bookingSelectedTimeLabel');
        if (!label) return;

        label.textContent = bookingSelectedTime
            ? `Créneau sélectionné : ${bookingSelectedTime}`
            : 'Sélectionnez un créneau disponible';
    }

    function setBookingSelection(time) {
        bookingSelectedTime = time || '';

        const hiddenInput = document.getElementById('bookingTime');
        if (hiddenInput) {
            hiddenInput.value = bookingSelectedTime;
        }

        document.querySelectorAll('.booking-slot-btn').forEach(button => {
            button.classList.toggle('selected', button.dataset.time === bookingSelectedTime);
        });

        updateBookingSelectedLabel();
    }

    function renderBookingAvailability(availability, dateValue) {
        const loadingEl = document.getElementById('bookingSlotsLoading');
        const container = document.getElementById('bookingSlotsContainer');
        const summaryEl = document.getElementById('bookingAvailabilitySummary');

        if (loadingEl) loadingEl.style.display = 'none';
        if (!container) return;

        bookingAvailability = availability || null;

        const slots = availability?.slots || [];
        const availableSlots = slots.filter(slot => slot.selectable);
        const blockedSlots = slots.filter(slot => slot.status === 'blocked');
        const bookedSlots = slots.filter(slot => slot.status === 'booked');

        if (summaryEl) {
            if (!slots.length) {
                summaryEl.textContent = dateValue
                    ? `Aucun créneau défini pour le ${new Date(`${dateValue}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`
                    : 'Sélectionnez une date pour afficher les disponibilités';
            } else {
                summaryEl.textContent = `${availableSlots.length} disponible(s), ${blockedSlots.length} bloqué(s), ${bookedSlots.length} réservé(s)`;
            }
        }

        if (!slots.length) {
            container.innerHTML = `
            <div class="booking-empty-state">
                <strong>Aucun créneau publié</strong>
                <span>Le psychologue n'a pas encore défini d'horaires pour cette date.</span>
            </div>
        `;
            setBookingSelection('');
            return;
        }

        const groupedSlots = BOOKING_TIME_GROUPS.map(group => ({
            ...group,
            slots: slots.filter(slot => getSlotPeriod(slot.startTime) === group.key)
        })).filter(group => group.slots.length > 0);

        const otherSlots = slots.filter(slot => !BOOKING_TIME_GROUPS.some(group => getSlotPeriod(slot.startTime) === group.key));
        if (otherSlots.length) {
            groupedSlots.push({
                key: 'other',
                label: 'Autres créneaux',
                slots: otherSlots
            });
        }

        container.innerHTML = groupedSlots.map(group => {
            const groupAvailable = group.slots.filter(s => s.selectable).length;
            const groupSlots = group.slots.map(slot => {
                const isAvailable = slot.selectable;
                const stateLabel = isAvailable ? 'Disponible' : (slot.status === 'blocked' ? 'Bloqué' : 'Réservé');
                const disabledAttr = isAvailable ? '' : 'disabled';
                const stateClass = isAvailable ? 'available' : slot.status;

                if (isAvailable) {
                    return `
                    <button type="button"
                        class="booking-slot-btn ${stateClass}"
                        data-time="${slot.startTime}"
                        ${disabledAttr}
                        onclick="selectBookingTime('${slot.startTime}')">
                        <span class="booking-slot-copy">
                            <span class="booking-slot-time">${slot.startTime}</span>
                            <span class="booking-slot-range">${formatBookingSlotRange(slot)}</span>
                        </span>
                        <span class="booking-slot-indicator"></span>
                    </button>
                `;
                }

                return `
                <button type="button"
                    class="booking-slot-btn ${stateClass}"
                    data-time="${slot.startTime}"
                    ${disabledAttr}
                    onclick="selectBookingTime('${slot.startTime}')">
                    <span class="booking-slot-copy">
                        <span class="booking-slot-time">${slot.startTime}</span>
                    </span>
                    <span class="booking-slot-state">${stateLabel}</span>
                </button>
            `;
            }).join('');

            return `
            <section class="booking-slot-group">
                <div class="booking-slot-group-header">
                    <h4>${group.label}</h4>
                    ${groupAvailable > 0 ? `<span class="booking-slot-group-count">${groupAvailable} disponible${groupAvailable > 1 ? 's' : ''}</span>` : ''}
                </div>
                <div class="booking-slot-grid">
                    ${groupSlots}
                </div>
            </section>
        `;
        }).join('');

        const firstAvailable = availableSlots[0];
        if (firstAvailable && !availableSlots.some(slot => slot.startTime === bookingSelectedTime)) {
            setBookingSelection(firstAvailable.startTime);
        } else {
            updateBookingSelectedLabel();
        }

        if (!availableSlots.length && summaryEl) {
            summaryEl.textContent = 'Aucun créneau disponible pour cette date';
        }
    }

    function selectBookingTime(time) {
        if (!bookingAvailability?.slots?.some(slot => slot.startTime === time && slot.selectable)) {
            return;
        }

        setBookingSelection(time);
    }

    async function refreshBookingAvailability() {
        if (!selectedDoctor) return;

        const dateInput = document.getElementById('bookingDate');
        const loadingEl = document.getElementById('bookingSlotsLoading');
        const container = document.getElementById('bookingSlotsContainer');

        const date = dateInput?.value;
        if (!date) {
            renderBookingAvailability(null, null);
            return;
        }

        const currentRequestId = ++bookingAvailabilityRequestId;

        if (loadingEl) loadingEl.style.display = 'block';
        if (container) {
            container.innerHTML = '';
        }

        try {
            const availability = await doctorAPI.getAvailability(selectedDoctor.id, date);
            if (currentRequestId !== bookingAvailabilityRequestId) return;

            renderBookingAvailability(availability, date);
        } catch (error) {
            if (currentRequestId !== bookingAvailabilityRequestId) return;

            console.error('Error loading booking availability:', error);
            if (loadingEl) loadingEl.style.display = 'none';
            if (container) {
                container.innerHTML = `
                <div class="booking-empty-state error">
                    <strong>Impossible de charger les créneaux</strong>
                    <span>Réessayez dans quelques instants.</span>
                </div>
            `;
            }
            setBookingSelection('');
        }
    }

    async function viewDoctor(doctorId) {
        try {
            const cachedDoctor = doctorCache.get(doctorId);
            let doctor;

            if (cachedDoctor && (Date.now() - cachedDoctor._cachedAt) < CACHE_DURATION) {
                doctor = cachedDoctor;
                renderDetailPanel(doctor);
                return;
            }

            const listDoctor = doctors.find(d => d.id === doctorId);
            if (listDoctor) {
                renderDetailPanel(listDoctor, true);
            }

            doctor = await doctorAPI.getById(doctorId);
            doctor._cachedAt = Date.now();
            doctorCache.set(doctorId, doctor);
            renderDetailPanel(doctor);

        } catch (error) {
            showToast('Erreur: ' + error.message, 'error');
        }
    }

    function renderDetailPanel(doctor, isPartial) {
        selectedDoctor = doctor;
        _reviewsLoadedFor = null;

        const avatarImg = document.querySelector('.psy-detail-avatar');
        const avatarDefault = document.querySelector('.psy-detail-avatar-default');
        if (avatarImg && avatarDefault) {
            if (doctor.avatar) {
                avatarImg.src = doctor.avatar;
                avatarImg.style.display = 'block';
                avatarDefault.style.display = 'none';
            } else {
                avatarImg.style.display = 'none';
                avatarDefault.style.display = 'flex';
            }
        }

        document.getElementById('detailName').textContent = doctor.fullname || 'Psychologue';

        const specialiteSpan = document.getElementById('detailSpecialite');
        if (specialiteSpan) {
            specialiteSpan.textContent = doctor.specialite || 'Psychologie';
        }

        const roleBadge = document.getElementById('detailRoleBadge');
        if (roleBadge) {
            const isCounselor = doctor.userType === 'counselor';
            roleBadge.textContent = isCounselor ? 'Conseiller' : 'Psychologue';
            roleBadge.className = 'detail-role-badge ' + (isCounselor ? 'counselor' : 'psy');
        }

        const rating = doctor.rating || 0;
        const starsEl = document.getElementById('detailStars');
        if (starsEl) {
            starsEl.innerHTML =
                '<span class="star filled">★</span>'.repeat(Math.floor(rating)) +
                '<span class="star">★</span>'.repeat(5 - Math.floor(rating));
        }

        const ratingValueEl = document.getElementById('detailRating');
        if (ratingValueEl) {
            ratingValueEl.textContent = rating.toFixed(1);
        }

        const patientsCountEl = document.getElementById('detailPatientsCount');
        if (patientsCountEl) {
            patientsCountEl.textContent = doctor.patientsCount || 0;
        }

        const sessionsEl = document.getElementById('detailSessionsCompleted');
        if (sessionsEl) {
            sessionsEl.textContent = doctor.sessionsCompleted || 0;
        }

        const phoneEl = document.getElementById('detailPhone');
        if (phoneEl) {
            phoneEl.textContent = (isPartial && !doctor.phone) ? 'Chargement...' : (doctor.phone || 'Non spécifié');
        }

        const adresseEl = document.getElementById('detailAdresse');
        if (adresseEl) {
            adresseEl.textContent = (isPartial && !doctor.adresse) ? 'Chargement...' : (doctor.adresse || 'Non spécifié');
        }

        const agrementEl = document.getElementById('detailAgrement');
        if (agrementEl) {
            agrementEl.textContent = (isPartial && !doctor.agrement) ? 'Chargement...' : (doctor.agrement || 'Non spécifié');
        }

        const diplomesEl = document.getElementById('detailDiplomes');
        if (diplomesEl) {
            diplomesEl.textContent = (isPartial && !doctor.diplomes) ? 'Chargement...' : (doctor.diplomes || 'Non spécifié');
        }

        const bioEl = document.getElementById('detailBio');
        if (bioEl) {
            bioEl.textContent = (isPartial && !doctor.bio) ? 'Chargement...' : (doctor.bio || 'Aucune description disponible.');
        }

        document.getElementById('psyDetailPanel').classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closePsyDetail() {
        document.getElementById('psyDetailPanel').classList.remove('active');
        document.body.style.overflow = 'auto';
    }

    async function contactDoctor() {
        if (!selectedDoctor) {
            showToast('Veuillez sélectionner un psychologue', 'error');
            return;
        }

        try {
            const status = await appointmentAPI.getUrgentAccessStatus();
            if (status.isActive) {
                localStorage.setItem('selectedDoctorId', selectedDoctor.id);
                localStorage.setItem('selectedDoctorName', selectedDoctor.fullname);
                window.location.href = 'patient_messagerie.html';
                return;
            }
        } catch (error) {
            console.log('Could not check VIP status');
        }

        // Close the profile panel first then show gate
        document.getElementById('psyDetailPanel').classList.remove('active');
        document.body.style.overflow = 'auto';
        showMessagerieVipGate();
    }

    function showMessagerieVipGate() {
        const existing = document.getElementById('messagerieVipGate');
        if (existing) { existing.style.display = 'flex'; return; }

        const modal = document.createElement('div');
        modal.id = 'messagerieVipGate';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;';
        modal.innerHTML = `
        <div style="background:white;border-radius:16px;padding:32px;max-width:420px;width:90%;text-align:center;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <h2 style="margin:0;color:#091346;font-size:18px;">Activer l'accès VIP</h2>
                <button onclick="document.getElementById('messagerieVipGate').remove()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#666;">&times;</button>
            </div>
            <div style="background:#f3effe;border-radius:10px;padding:16px;margin-bottom:20px;">
                <div style="font-size:28px;font-weight:800;color:#c5b4e4;">1 000 DA</div>
                <div style="font-size:13px;color:#64748b;margin-top:4px;">Accès valide 30 jours</div>
            </div>
            <p style="color:#64748b;line-height:1.6;margin-bottom:20px;font-size:14px;">
                La messagerie directe avec les psychologues est réservée aux patients ayant un accès VIP actif.
            </p>
            <div style="display:flex;flex-direction:column;gap:12px;text-align:left;">
                <div>
                    <label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px;">Numéro CCP</label>
                    <input type="text" id="msgVipCcp" placeholder="1234 5678 9012 3456" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div>
                        <label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px;">Date d'expiration</label>
                        <input type="month" id="msgVipExp" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px;">CVV</label>
                        <input type="password" id="msgVipCvv" maxlength="3" placeholder="123" style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;">
                    </div>
                </div>
                <button id="msgVipPayBtn" onclick="activateVipForMessagerie()" style="width:100%;padding:14px;background:#c5b4e4;color:white;border:none;border-radius:10px;font-weight:700;font-size:15px;cursor:pointer;margin-top:4px;">
                    Payer et accéder à la messagerie
                </button>
            </div>
        </div>
    `;

        document.body.appendChild(modal);
        modal.addEventListener('click', function (e) {
            if (e.target === modal) modal.remove();
        });
    }

    async function activateVipForMessagerie() {
        const ccp = document.getElementById('msgVipCcp')?.value;
        const cvv = document.getElementById('msgVipCvv')?.value;

        if (!ccp || !cvv) {
            showToast('Veuillez remplir tous les champs', 'error');
            return;
        }

        const btn = document.getElementById('msgVipPayBtn');
        if (btn) { btn.textContent = 'Traitement...'; btn.disabled = true; }

        try {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await appointmentAPI.activateUrgentAccess();

            showToast('Accès VIP activé! Accès valide 30 jours.', 'success');
            document.getElementById('messagerieVipGate')?.remove();

            if (selectedDoctor) {
                localStorage.setItem('selectedDoctorId', selectedDoctor.id);
                localStorage.setItem('selectedDoctorName', selectedDoctor.fullname);
            }
            window.location.href = 'patient_messagerie.html';

        } catch (error) {
            console.error('Error activating:', error);
            showToast('Erreur lors de l\'activation', 'error');
            if (btn) { btn.textContent = 'Payer et accéder à la messagerie'; btn.disabled = false; }
        }
    }

    window.activateVipForMessagerie = activateVipForMessagerie;

    let vipAnswers = [];

    async function openBookingModal() {
        if (!selectedDoctor) {
            showToast('Veuillez sélectionner un psychologue', 'error');
            return;
        }

        // Close profile panel first
        document.getElementById('psyDetailPanel').classList.remove('active');
        document.body.style.overflow = 'hidden';

        openBookingModalDirect();
    }

    function openBookingModalDirect() {
        document.getElementById('bookingDoctorName').textContent = selectedDoctor.fullname;

        const today = new Date();
        const minDate = today.toISOString().split('T')[0];
        const dateInput = document.getElementById('bookingDate');
        if (dateInput) {
            dateInput.min = minDate;
            dateInput.value = minDate;
        }

        bookingAvailability = null;
        bookingSelectedTime = '';
        bookingAvailabilityRequestId += 1;
        setBookingSelection('');

        const loadingEl = document.getElementById('bookingSlotsLoading');
        const container = document.getElementById('bookingSlotsContainer');
        if (loadingEl) loadingEl.style.display = 'block';
        if (container) container.innerHTML = '';

        document.getElementById('bookingModal').classList.add('active');
        document.body.style.overflow = 'hidden';

        refreshBookingAvailability();
    }

    async function confirmBooking() {
        const dateEl = document.getElementById('bookingDate');
        const timeEl = document.getElementById('bookingTime');
        const mediaEl = document.getElementById('bookingMedia');

        const date = dateEl?.value;
        const time = timeEl?.value;
        const mediaType = mediaEl?.value;

        if (!date || !time || !mediaType) {
            showToast('Veuillez remplir tous les champs', 'error');
            return;
        }

        // Check if doctor has VIP questions — show questionnaire before submitting
        try {
            const doctorData = await doctorAPI.getById(selectedDoctor.id);
            if (doctorData.vipQuestions && doctorData.vipQuestions.length > 0) {
                // Hide booking modal, show questionnaire
                document.getElementById('bookingModal').classList.remove('active');
                showVipQuestionnaire(doctorData.vipQuestions, { date, time, mediaType });
                return;
            }
        } catch (e) {
            console.log('Could not check VIP questions');
        }

        // No questions — submit directly
        await submitBooking({ date, time, mediaType });
    }

    function showVipQuestionnaire(questions, bookingData) {
        const existing = document.getElementById('vipQuestionnaireModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'vipQuestionnaireModal';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:2000;display:flex;align-items:center;justify-content:center;';

        const questionsHtml = questions.map((q, i) => `
        <div style="margin-bottom:16px;">
            <label style="font-size:13px;font-weight:600;color:#091346;display:block;margin-bottom:6px;">
                ${i + 1}. ${escapeHtml(q.text)}
            </label>
            <textarea id="vipAnswer_${i}" rows="2"
                placeholder="Votre réponse..."
                style="width:100%;padding:10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;resize:vertical;box-sizing:border-box;font-family:inherit;"></textarea>
        </div>
    `).join('');

        const questionsJson = encodeURIComponent(JSON.stringify(questions));
        const bookingJson = encodeURIComponent(JSON.stringify(bookingData));

        modal.innerHTML = `
        <div style="background:white;border-radius:16px;padding:32px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;position:relative;">
            <button onclick="document.getElementById('vipQuestionnaireModal').remove(); document.getElementById('bookingModal').classList.add('active');"
                style="position:absolute;top:16px;right:16px;background:none;border:none;font-size:24px;cursor:pointer;color:#666;line-height:1;">&times;</button>
            <h2 style="margin:0 0 6px;color:#091346;font-size:18px;">Questionnaire du praticien</h2>
            <p style="color:#64748b;font-size:13px;margin-bottom:20px;line-height:1.5;">
                Ce praticien vous demande de répondre à quelques questions avant de confirmer votre rendez-vous.
            </p>
            ${questionsHtml}
            <button onclick="submitVipQuestionnaire('${questionsJson}','${bookingJson}')"
                style="width:100%;padding:14px;background:#091346;color:white;border:none;border-radius:10px;font-weight:700;font-size:15px;cursor:pointer;margin-top:8px;">
                Confirmer le rendez-vous
            </button>
        </div>
    `;

        document.body.appendChild(modal);
        modal.addEventListener('click', e => {
            if (e.target === modal) {
                modal.remove();
                document.getElementById('bookingModal').classList.add('active');
            }
        });
    }

    async function submitVipQuestionnaire(questionsJson, bookingJson) {
        const questions = JSON.parse(decodeURIComponent(questionsJson));
        const bookingData = JSON.parse(decodeURIComponent(bookingJson));

        vipAnswers = questions.map((q, i) => ({
            question: q.text,
            answer: document.getElementById(`vipAnswer_${i}`)?.value?.trim() || ''
        }));

        const unanswered = vipAnswers.filter(a => !a.answer);
        if (unanswered.length > 0) {
            showToast('Veuillez répondre à toutes les questions', 'error');
            return;
        }

        document.getElementById('vipQuestionnaireModal')?.remove();
        await submitBooking(bookingData);
    }

    async function submitBooking(bookingData) {
        const { date, time, mediaType } = bookingData;
        console.log('=== SUBMIT BOOKING vipAnswers:', JSON.stringify(vipAnswers));
        console.log('=== BOOKING DATA:', JSON.stringify(bookingData));


        try {
            await appointmentAPI.create({
                doctorId: selectedDoctor.id,
                date,
                time,
                mediaType,
                vipAnswers: vipAnswers.length > 0 ? vipAnswers : undefined
            });
            vipAnswers = [];
            showToast('Rendez-vous réservé avec succès!', 'success');
            closeBookingModal();
            window.location.href = 'patient_rendez_vous.html';
        } catch (error) {
            showToast('Erreur: ' + error.message, 'error');
        }
    }

    window.submitVipQuestionnaire = submitVipQuestionnaire;
    async function bookAppointment() {
        if (!selectedDoctor) {
            showToast('Veuillez sélectionner un psychologue', 'error');
            return;
        }

        const dateStr = prompt('Date du rendez-vous (JJ/MM/AAAA):', '');
        if (!dateStr) return;

        const dateParts = dateStr.split('/');
        if (dateParts.length !== 3) {
            showToast('Format de date invalide. Utilisez JJ/MM/AAAA', 'error');
            return;
        }

        const date = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
        const time = prompt('Heure du rendez-vous (HH:MM):', '10:00');
        if (!time) return;

        const mediaType = prompt('Type de consultation (video/phone/chat):', 'video');
        if (!mediaType) return;

        const confirmMsg = `Confirmer le rendez-vous avec ${selectedDoctor.fullname}?\nDate: ${dateStr}\nHeure: ${time}\nType: ${mediaType}`;
        if (!confirm(confirmMsg)) return;

        try {
            const result = await appointmentAPI.create({
                doctorId: selectedDoctor.id,
                date: date,
                time: time,
                mediaType: mediaType
            });

            showToast('Rendez-vous réservé avec succès!', 'success');
            closePsyDetail();
            window.location.href = 'patient_rendez_vous.html';
        } catch (error) {
            showToast('Erreur: ' + error.message, 'error');
        }
    }
    function closeBookingModal() {
        document.getElementById('bookingModal').classList.remove('active');
        bookingAvailability = null;
        bookingSelectedTime = '';
        bookingAvailabilityRequestId += 1;
        setBookingSelection('');
        vipAnswers = [];
        document.body.style.overflow = 'auto';
    }

    function setTypeFilter(type) {
        activeTypeFilter = type;
        document.getElementById('typeAll')?.classList.toggle('active', type === 'all');
        document.getElementById('typePsy')?.classList.toggle('active', type === 'psychologue');
        document.getElementById('typeCounselor')?.classList.toggle('active', type === 'counselor');
        filterPsychologues();
    }

    function resetFilters() {
        activeTypeFilter = 'all';
        const defaults = { searchInput: '', sortFilter: 'default', ratingFilter: '0', dateFilter: 'all', availFilter: 'all' };
        Object.entries(defaults).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        });
        document.getElementById('typeAll')?.classList.add('active');
        document.getElementById('typePsy')?.classList.remove('active');
        document.getElementById('typeCounselor')?.classList.remove('active');
        const resetBtn = document.getElementById('resetFiltersBtn');
        if (resetBtn) resetBtn.style.display = 'none';
        filterPsychologues();
    }

    function filterPsychologues() {
        const searchTerm = (document.getElementById('searchInput')?.value || '').toLowerCase();
        const sortValue = document.getElementById('sortFilter')?.value || 'default';
        const minRating = parseFloat(document.getElementById('ratingFilter')?.value || '0');
        const dateValue = document.getElementById('dateFilter')?.value || 'all';
        const availValue = document.getElementById('availFilter')?.value || 'all';

        const hasActiveFilter = searchTerm || sortValue !== 'default' || minRating > 0 || dateValue !== 'all' || availValue !== 'all' || activeTypeFilter !== 'all';
        const resetBtn = document.getElementById('resetFiltersBtn');
        if (resetBtn) resetBtn.style.display = hasActiveFilter ? 'flex' : 'none';

        let filtered = [...doctors];

        if (activeTypeFilter !== 'all') {
            filtered = filtered.filter(d => {
                const role = d.role || d.userType || '';
                return activeTypeFilter === 'psychologue' ? role === 'psychologue' : role === 'counselor';
            });
        }

        if (urgentActif) {
            filtered = filtered.filter(d => d.isAvailable);
        }

        if (searchTerm) {
            filtered = filtered.filter(d => (d.fullname || '').toLowerCase().includes(searchTerm));
        }

        if (minRating > 0) {
            filtered = filtered.filter(d => (d.rating || 0) >= minRating);
        }

        if (dateValue !== 'all') {
            const day = parseInt(dateValue, 10);
            filtered = filtered.filter(d =>
                Array.isArray(d.availableSlots) && d.availableSlots.some(s => s.dayOfWeek === day)
            );
        }

        if (availValue === 'online') {
            filtered = filtered.filter(d => d.isAvailable);
        }

        if (sortValue === 'rating-desc') {
            filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        } else if (sortValue === 'sessions-desc') {
            filtered.sort((a, b) => (b.sessionsCompleted || 0) - (a.sessionsCompleted || 0));
        } else if (sortValue === 'price-asc') {
            filtered.sort((a, b) => (a.tarif || 0) - (b.tarif || 0));
        } else if (sortValue === 'price-desc') {
            filtered.sort((a, b) => (b.tarif || 0) - (a.tarif || 0));
        }

        renderDoctors(filtered);

        const resultEl = document.getElementById('resultCount');
        if (resultEl) {
            const total = filtered.length;
            if (urgentActif) {
                resultEl.innerHTML = `${total} consultant${total > 1 ? 's' : ''} EN LIGNE disponible${total > 1 ? 's' : ''} pour appel immédiat`;
            } else {
                resultEl.innerHTML = `${total} consultant${total > 1 ? 's' : ''} trouvé${total > 1 ? 's' : ''}`;
            }
        }
    }

    function toggleUrgentFilter() {
        urgentActif = !urgentActif;
        const btn = document.getElementById('urgentButton');
        if (urgentActif) {
            btn.style.background = '#e74c3c';
            btn.style.color = 'white';
        } else {
            btn.style.background = '';
            btn.style.color = '';
        }
        filterPsychologues();
    }
    window.toggleUrgentFilter = toggleUrgentFilter;
    window.setTypeFilter = setTypeFilter;
    window.resetFilters = resetFilters;





    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            closeUrgentModal();
            closeUrgentDoctorModal();
            closePsyDetail();
        }
    });
    function closeUrgentModal() {
        document.getElementById('urgentModal')?.classList.remove('active');
        document.body.style.overflow = 'auto';
    }

    function openUrgentDoctorModal() {
        const onlinePsys = doctors.filter(d => d.isAvailable && (d.role === 'psychologue' || d.userType === 'psychologue'));
        const onlineCounselors = doctors.filter(d => d.isAvailable && (d.role === 'counselor' || d.userType === 'counselor'));

        if (onlinePsys.length === 0 && onlineCounselors.length === 0) {
            showToast('Aucun professionnel disponible en ce moment', 'error');
            return;
        }

        urgentTargetDoctorId = null;
        urgentSelectedTab = 'psychologue';

        renderUrgentDoctorList(onlinePsys, onlineCounselors);
        document.getElementById('urgentDoctorModal').classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function renderUrgentDoctorList(psys, counselors) {
        const psyTab = document.getElementById('urgentTabPsy');
        const counselorTab = document.getElementById('urgentTabCounselor');
        const psyList = document.getElementById('urgentPsyList');
        const counselorList = document.getElementById('urgentCounselorList');

        // Tab counts
        psyTab.textContent = `Psychologues (${psys.length})`;
        counselorTab.textContent = `Conseillers (${counselors.length})`;

        // Render psychologues
        psyList.innerHTML = psys.length === 0
            ? '<p style="text-align:center;color:#999;padding:20px;">Aucun psychologue en ligne</p>'
            : psys.map(d => renderUrgentDoctorItem(d)).join('');

        // Render counselors
        counselorList.innerHTML = counselors.length === 0
            ? '<p style="text-align:center;color:#999;padding:20px;">Aucun conseiller en ligne</p>'
            : counselors.map(d => renderUrgentDoctorItem(d)).join('');

        // Show first tab
        switchUrgentTab('psychologue');
    }

    function renderUrgentDoctorItem(doctor) {
        const initial = (doctor.fullname || '?').charAt(0).toUpperCase();
        const avatar = doctor.avatar
            ? `<img src="${doctor.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">`
            : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:#44AA99;background:#e8f4ee;border-radius:12px;">${initial}</div>`;

        return `
        <div class="urgent-doctor-item" id="urgentDoc_${doctor.id}" onclick="selectUrgentDoctor('${doctor.id}')">
            <div class="urgent-doctor-avatar-square">
                ${avatar}
                <div class="urgent-online-dot"></div>
            </div>
            <div class="urgent-doctor-info">
                <strong>${doctor.fullname}</strong>
                <span>${doctor.specialite || 'Général'}</span>
                <span class="urgent-rating">
                    ${'★'.repeat(Math.floor(doctor.rating || 0))}${'☆'.repeat(5 - Math.floor(doctor.rating || 0))}
                    ${doctor.rating ? Number(doctor.rating).toFixed(1) : '0.0'}
                </span>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
                <div class="urgent-doctor-check" id="urgentCheck_${doctor.id}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" width="16" height="16">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                </div>
              <button onclick="event.stopPropagation(); openDoctorProfileFromUrgent('${doctor.id}')" 
    style="background:#091346;color:white;border:none;padding:6px 10px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;">
    Profil
</button>
            </div>
        </div>
    `;
    }
    function openDoctorProfileFromUrgent(doctorId) {
        document.getElementById('urgentDoctorModal').classList.remove('active');
        viewDoctor(doctorId);

        // Override closePsyDetail to reopen urgent modal after closing
        const originalClose = window.closePsyDetail;
        window.closePsyDetail = function () {
            originalClose();
            document.getElementById('urgentDoctorModal').classList.add('active');
            window.closePsyDetail = originalClose; // restore
        };
    }
    window.openDoctorProfileFromUrgent = openDoctorProfileFromUrgent;

    function switchUrgentTab(tab) {
        urgentSelectedTab = tab;
        const psyTab = document.getElementById('urgentTabPsy');
        const counselorTab = document.getElementById('urgentTabCounselor');
        const psyList = document.getElementById('urgentPsyList');
        const counselorList = document.getElementById('urgentCounselorList');

        if (tab === 'psychologue') {
            psyTab.classList.add('active');
            counselorTab.classList.remove('active');
            psyList.style.display = 'block';
            counselorList.style.display = 'none';
        } else {
            counselorTab.classList.add('active');
            psyTab.classList.remove('active');
            counselorList.style.display = 'block';
            psyList.style.display = 'none';
        }
    }

    function selectUrgentDoctor(doctorId) {
        // Deselect previous
        if (urgentTargetDoctorId) {
            const prev = document.getElementById(`urgentDoc_${urgentTargetDoctorId}`);
            const prevCheck = document.getElementById(`urgentCheck_${urgentTargetDoctorId}`);
            if (prev) prev.classList.remove('selected');
            if (prevCheck) prevCheck.style.display = 'none';
        }

        urgentTargetDoctorId = doctorId;

        const item = document.getElementById(`urgentDoc_${doctorId}`);
        const check = document.getElementById(`urgentCheck_${doctorId}`);
        if (item) item.classList.add('selected');
        if (check) check.style.display = 'flex';

        document.getElementById('urgentSendBtn').disabled = false;
    }

    function closeUrgentDoctorModal() {
        document.getElementById('urgentDoctorModal').classList.remove('active');
        document.body.style.overflow = 'auto';
        urgentTargetDoctorId = null;
    }

    async function sendUrgentRequest() {
        if (!urgentTargetDoctorId) {
            showToast('Veuillez sélectionner un professionnel', 'error');
            return;
        }

        const btn = document.getElementById('urgentSendBtn');
        const originalText = btn.textContent;
        btn.textContent = 'Envoi...';
        btn.disabled = true;

        try {
            await appointmentAPI.createUrgent(
                urgentTargetDoctorId,
                'Patient requested URGENT VIP consultation',
                undefined
            );

            urgentActif = true;
            document.getElementById('urgentBanner').style.display = 'flex';
            showToast('Demande URGENTE envoyée ! En attente de réponse.', 'success');
            closeUrgentDoctorModal();
            filterPsychologues();

        } catch (error) {
            console.error('Error sending urgent:', error);
            showToast('Erreur lors de l\'envoi', 'error');
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }

    async function openUrgentPayment() {
        try {
            const status = await appointmentAPI.getUrgentAccessStatus();
            if (status.isActive) {
                showToast(`Accès URGENT actif! ${status.daysLeft} jour(s) restant(s)`, 'info');
                openUrgentDoctorModal();
                return;
            }
        } catch (error) {
            console.log('Could not check urgent access status');
        }

        // Show payment modal
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const timeInput = document.getElementById('urgentAppointmentTime');
        if (timeInput) timeInput.value = `${hours}:${minutes}`;

        document.getElementById('urgentModal').classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    async function activateUrgent() {
        const ccpNumber = document.getElementById('ccpNumber')?.value;
        const cvv = document.getElementById('cvv')?.value;

        if (!ccpNumber || !cvv) {
            showToast('Veuillez remplir tous les champs de paiement', 'error');
            return;
        }

        const btn = document.querySelector('.pay-urgent-btn');
        const originalText = btn?.textContent || 'Payer';
        if (btn) { btn.textContent = 'Traitement...'; btn.disabled = true; }

        try {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await appointmentAPI.activateUrgentAccess();

            showToast('Paiement réussi! Accès actif pour 30 jours.', 'success');
            closeUrgentModal();
            openUrgentDoctorModal();

            document.getElementById('ccpNumber').value = '';
            document.getElementById('cvv').value = '';

        } catch (error) {
            console.error('Error activating urgent:', error);
            showToast('Erreur lors de l\'activation URGENT', 'error');
        } finally {
            if (btn) { btn.textContent = originalText; btn.disabled = false; }
        }
    }

    function renderStarsDetail(rating) {
        return [1,2,3,4,5].map(i =>
            `<span style="color:${i <= rating ? '#f59e0b' : '#d1d5db'};font-size:15px;">★</span>`
        ).join('');
    }

    let _reviewsLoadedFor = null;

    async function loadDetailReviews() {
        if (!selectedDoctor) return;
        const container = document.getElementById('avisContent');
        if (!container) return;

        if (_reviewsLoadedFor === selectedDoctor.id) return;
        _reviewsLoadedFor = selectedDoctor.id;

        container.innerHTML = '<p style="color:#888;font-size:13px;padding:16px 0;">Chargement...</p>';

        try {
            const { reviews } = await reviewAPI.getForDoctor(selectedDoctor.id);

            if (!reviews || reviews.length === 0) {
                container.innerHTML = '<div class="avis-empty"><p>Aucun avis disponible pour le moment.</p></div>';
                return;
            }

            const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
            const dist = [5,4,3,2,1].map(n => ({ n, count: reviews.filter(r => r.rating === n).length }));

            container.innerHTML = `
                <div style="display:flex;align-items:center;gap:14px;padding:14px;background:#f8f7ff;border-radius:10px;margin-bottom:16px;">
                    <div style="text-align:center;min-width:64px;">
                        <div style="font-size:34px;font-weight:700;color:#1a1a2e;line-height:1;">${avg.toFixed(1)}</div>
                        <div style="margin:3px 0;">${renderStarsDetail(Math.round(avg))}</div>
                        <div style="color:#888;font-size:11px;">${reviews.length} avis</div>
                    </div>
                    <div style="flex:1;">
                        ${dist.map(d => `
                        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                            <span style="color:#888;font-size:11px;width:10px;">${d.n}</span>
                            <span style="color:#f59e0b;font-size:11px;">★</span>
                            <div style="flex:1;height:5px;background:#e5e7eb;border-radius:3px;">
                                <div style="height:100%;background:#f59e0b;width:${reviews.length ? (d.count/reviews.length*100) : 0}%;border-radius:3px;"></div>
                            </div>
                            <span style="color:#888;font-size:11px;width:14px;">${d.count}</span>
                        </div>`).join('')}
                    </div>
                </div>
                <div>
                ${reviews.map(r => {
                    const name = r.patient?.fullname || 'Patient';
                    const initial = name.charAt(0).toUpperCase();
                    const date = new Date(r.createdAt).toLocaleDateString('fr-FR', { day:'numeric', month:'short', year:'numeric' });
                    return `
                    <div style="border-bottom:1px solid #f0f0f0;padding:12px 0;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                            <div style="width:30px;height:30px;border-radius:50%;background:#7c3aed;color:white;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:12px;flex-shrink:0;">${initial}</div>
                            <div style="flex:1;">
                                <div style="font-weight:600;font-size:13px;color:#1a1a2e;">${name}</div>
                                <div style="font-size:11px;color:#888;">${date}</div>
                            </div>
                            <div>${renderStarsDetail(r.rating)}</div>
                        </div>
                        ${r.comment ? `<p style="margin:0;font-size:12px;color:#555;line-height:1.5;padding-left:38px;">${r.comment}</p>` : ''}
                    </div>`;
                }).join('')}
                </div>`;
        } catch (e) {
            container.innerHTML = '<div class="avis-empty"><p>Impossible de charger les avis.</p></div>';
            _reviewsLoadedFor = null;
        }
    }

    function switchTab(tab) {
        document.querySelectorAll('.tab-detail-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

        if (tab === 'apercu') {
            document.querySelector('.tab-detail-btn:first-child').classList.add('active');
            document.getElementById('apercuContent').classList.add('active');
        } else {
            document.querySelector('.tab-detail-btn:last-child').classList.add('active');
            document.getElementById('avisContent').classList.add('active');
            loadDetailReviews();
        }
    }

    async function requestUrgentForDoctor() {
        if (!selectedDoctor) return;

        if (!selectedDoctor.isAvailable) {
            if (typeof showToast === 'function') showToast('Ce praticien n\'est pas disponible en ce moment', 'error');
            return;
        }

        const btn = document.querySelector('.urgent-consult-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Envoi...'; }

        try {
            await appointmentAPI.createUrgent(selectedDoctor.id, 'Consultation urgente immédiate');
            if (typeof showToast === 'function') showToast('Demande envoyée ! En attente de réponse du praticien...', 'info');
            if (btn) { btn.textContent = 'Demande envoyée...'; }
        } catch (err) {
            if (typeof showToast === 'function') showToast(err.message || 'Erreur lors de l\'envoi de la demande', 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor"/></svg>Consultation Urgente'; }
        }
    }

    window.viewDoctor = viewDoctor;
    window.closePsyDetail = closePsyDetail;
    window.bookAppointment = openBookingModal;
    window.contactDoctor = contactDoctor;
    window.openBookingModal = openBookingModal;
    window.requestUrgentForDoctor = requestUrgentForDoctor;
    window.closeBookingModal = closeBookingModal;
    window.confirmBooking = confirmBooking;
    window.filterPsychologues = filterPsychologues;
    window.openUrgentPayment = openUrgentPayment;
    window.closeUrgentModal = closeUrgentModal;
    window.activateUrgent = activateUrgent;
    window.selectBookingTime = selectBookingTime;
    window.switchTab = switchTab;
    window.switchUrgentTab = switchUrgentTab;
    window.selectUrgentDoctor = selectUrgentDoctor;
    window.closeUrgentDoctorModal = closeUrgentDoctorModal;
    window.sendUrgentRequest = sendUrgentRequest;
    // highlightCurrentSidebarLink removed — use global from api.js





    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            closeUrgentModal();
            closePsyDetail();
        }
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
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPage);
    } else {
        initPage();
    }
})();
