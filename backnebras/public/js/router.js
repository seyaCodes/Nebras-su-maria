/**
 * router.js — Client-side SPA router for multi-page HTML apps
 */

(function () {

    const PAGE_SCRIPTS = {
        // Admin
        'admin_dashboard.html': ['js/pages/admin.js'],
        'admin_utilisateurs.html': ['js/pages/admin.js'],
        'admin_validation.html': ['js/pages/admin.js'],
        'admin_paiements.html': ['js/pages/admin.js'],
        'admin_statistiques.html': ['js/pages/admin.js'],
        'admin.html': ['js/pages/admin.js'],
        // Psychologue
        'psychologue_dashboard.html': ['js/shared/doctor-dashboard.js'],
        'psychologue_mes_patients.html': ['js/shared/doctor-mes-patients.js'],
        'psychologue_emploi_du_temps.html': ['js/shared/doctor-emploi-du-temps.js'],
        'psychologue_messagerie.html': ['js/shared/doctor-messagerie.js'],
        'psychologue_honoraires.html': ['js/shared/doctor-honoraires.js'],
        'psychologue_groupes.html': ['js/psychologue_groupes.js'],
        'psychologue_VIP.html': ['js/shared/doctor-vip.js', 'js/psychologue_VIP.js'],
        'psychologue_analytics.html': ['js/shared/doctor-analytics.js'],
        'psychologue_profil.html': ['js/shared/doctor-profil.js'],
        // Patient
        'patient_dashboard.html': ['js/patient-call-listener.js', 'js/patient_dashboard.js'],
        'patient_psychologue.html': ['js/patient-call-listener.js', 'js/patient_psychologue.js'],
        'patient_rendez_vous.html': ['js/patient_rendez_vous.js'],
        'patient_messagerie.html': ['js/patient_messagerie.js'],
        'patient_therapie.html': ['js/patient_therapie.js'],
        'patient_profil.html': ['js/patient_profil.js'],
        'psychologue_profil.html': ['js/shared/doctor-profil.js', 'js/psychologue_profil.js'],
        // Counselor
        'counselor_dashboard.html': ['js/shared/doctor-dashboard.js'],
        'counselor_mes_patients.html': ['js/shared/doctor-mes-patients.js'],
        'counselor_emploi_du_temps.html': ['js/shared/doctor-emploi-du-temps.js'],
        'counselor_messagerie.html': ['js/shared/doctor-messagerie.js'],
        'counselor_honoraires.html': ['js/shared/doctor-honoraires.js', 'js/counselor_honoraires.js'],
        'counselor_VIP.html': ['js/shared/doctor-vip.js', 'js/counselor_VIP.js'],
        'counselor_analytics.html': ['js/shared/doctor-analytics.js'],
        'counselor_profil.html': ['js/shared/doctor-profil.js', 'js/counselor_profil.js'],
    };

    const NAV_SELECTOR = '.sidebar .nav-item';
    const CONTENT_SELECTOR = '.main-content';
    const OVERLAY_IDS = [
        'patientProfileModal',
        'psyDetailPanel',
        'urgentModal',
        'bookingModal',
        'urgentBanner',
        'vipPaymentModal',
        'slotModal',
        'unavailableModal',
        'confirmModal',
        'tarifModal',
        'passwordModal',
    ];

    // ── Helpers ───────────────────────────────────────────────────────────────

    function getPageName(url) {
        return (url || '').split('/').pop().split('?')[0];
    }

    function showLoading(el) {
        el.style.opacity = '0.4';
        el.style.pointerEvents = 'none';
        el.style.transition = 'opacity 0.15s ease';
    }

    function hideLoading(el) {
        el.style.opacity = '1';
        el.style.pointerEvents = '';
    }

    function setActiveLink(pageName) {
        document.querySelectorAll(NAV_SELECTOR).forEach(link => {
            const linkPage = getPageName(link.getAttribute('href') || '');
            link.classList.toggle('active', linkPage === pageName);
        });
    }

    function loadScript(src) {
        return new Promise((resolve) => {
            document.querySelectorAll(`script[data-router-src="${src}"]`).forEach(s => s.remove());
            const script = document.createElement('script');
            script.src = src + '?_r=' + Date.now();
            script.dataset.routerSrc = src;
            script.onload = resolve;
            script.onerror = () => {
                console.warn('[router] Could not load script:', src);
                resolve();
            };
            document.body.appendChild(script);
        });
    }

    async function fetchPage(url) {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
        const html = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const mainEl = doc.querySelector(CONTENT_SELECTOR);
        if (!mainEl) throw new Error(`No ${CONTENT_SELECTOR} in ${url}`);

        const overlays = {};
        OVERLAY_IDS.forEach(id => {
            const el = doc.getElementById(id);
            if (el) overlays[id] = el.outerHTML;
        });

        const pageStyles = [];
        doc.querySelectorAll('style').forEach(s => pageStyles.push(s.textContent));

        const titleEl = doc.querySelector('title');
        const title = titleEl ? titleEl.textContent : '';

        return { mainHTML: mainEl.innerHTML, overlays, title, pageStyles };
    }

    // ── Core navigate ─────────────────────────────────────────────────────────

    async function navigate(href, pushState = true) {
        const container = document.querySelector(CONTENT_SELECTOR);
        if (!container) return;

        const pageName = getPageName(href);
        if (getPageName(window.location.href) === pageName) return;

        showLoading(container);

        try {
            const { mainHTML, overlays, title, pageStyles } = await fetchPage(href);

            // 1. Swap main content
            container.innerHTML = mainHTML;
            hideLoading(container);

            // 2. Inject page-specific styles
            document.querySelectorAll('style[data-router-page]').forEach(s => s.remove());
            (pageStyles || []).forEach(css => {
                const el = document.createElement('style');
                el.setAttribute('data-router-page', '1');
                el.textContent = css;
                document.head.appendChild(el);
            });

            // 3. Replace / inject overlay elements
            OVERLAY_IDS.forEach(id => {
                const existing = document.getElementById(id);
                if (overlays[id]) {
                    const tmp = document.createElement('div');
                    tmp.innerHTML = overlays[id];
                    const newEl = tmp.firstElementChild;
                    if (existing) {
                        existing.replaceWith(newEl);
                    } else {
                        document.body.appendChild(newEl);
                    }
                } else if (existing) {
                    existing.remove();
                }
            });

            // 4. Update URL + title
            if (pushState) window.history.pushState({ href }, '', href);
            if (title) document.title = title;

            // 5. Update active nav link
            setActiveLink(pageName);

            // 6. Re-run page scripts
            const scripts = PAGE_SCRIPTS[pageName] || [];
            for (const src of scripts) {
                await loadScript(src);
            }

        } catch (err) {
            hideLoading(container);
            console.error('[router] Navigation failed, falling back:', err);
            window.location.href = href;
        }
    }

    // ── Event wiring ──────────────────────────────────────────────────────────

    document.addEventListener('click', function (e) {
        const link = e.target.closest(NAV_SELECTOR);
        if (!link) return;

        const href = link.getAttribute('href');

        // Skip invalid hrefs
        if (!href || href === '#' || href.startsWith('javascript')) return;

        // Skip logout and any other hard-nav onclick handlers
        const onclickVal = link.getAttribute('onclick') || '';
        if (onclickVal.includes('logout')) return;

        e.preventDefault();
        navigate(href);
    });

    window.addEventListener('popstate', function (e) {
        const href = e.state?.href || window.location.pathname;
        navigate(href, false);
    });

    window.history.replaceState({ href: window.location.href }, '', window.location.href);

})();