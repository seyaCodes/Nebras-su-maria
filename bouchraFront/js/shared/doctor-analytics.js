// ============================================
// DOCTOR ANALYTICS - VIP Only
// ============================================
(function () {

    async function initAnalytics() {
        if (!isLoggedIn()) {
            window.location.href = 'auth.html';
            return;
        }
        if (getUserType() !== 'psychologue' && getUserType() !== 'counselor') {
            redirectByUserType(getUserType());
            return;
        }

        const content = document.getElementById('analyticsContent');
        const warning = document.getElementById('vipWarning');
        if (content) content.style.display = 'none';
        if (warning) warning.style.display = 'none';

        highlightCurrentSidebarLink();
        await loadSidebarUserData();
        await loadAnalytics();
    }

    async function loadAnalytics() {
        const content = document.getElementById('analyticsContent');
        const warning = document.getElementById('vipWarning');

        // Show loading
        if (content) {
            content.style.display = 'block';
            content.innerHTML = '<div style="padding:60px;text-align:center;color:#94a3b8;">Chargement...</div>';
        }

        try {
            const data = await doctorAPI.getAnalytics();

            if (warning) warning.style.display = 'none';
            if (content) {
                content.style.display = 'block';
                // Re-inject the full analytics HTML (was cleared by loading state)
                content.innerHTML = getAnalyticsHTML();
            }

            renderAnalytics(data);

        } catch (error) {
            // 403 = not VIP, any other error = also show gate
            if (warning) warning.style.display = 'flex';
            if (content) content.style.display = 'none';
        }
    }

    // ── Full analytics HTML template ──────────────────────────────────────────
    function getAnalyticsHTML() {
        return `
        <div class="analytics-wrap">

            <div class="an-card">
                <h2>Sessions</h2>
                <div class="kpi-row">
                    <div class="kpi-item">
                        <div class="kpi-label">Total</div>
                        <div class="kpi-value" id="kpiTotalSessions">—</div>
                    </div>
                    <div class="kpi-item">
                        <div class="kpi-label">Ce mois</div>
                        <div class="kpi-value" id="kpiSessionsThisMonth">—</div>
                    </div>
                    <div class="kpi-item">
                        <div class="kpi-label">Moy / semaine</div>
                        <div class="kpi-value" id="kpiAvgPerWeek">—</div>
                    </div>
                </div>
                <div style="margin-top:24px;">
                    <div class="chart-wide" id="sessionsChart"></div>
                </div>
            </div>

            <div class="an-card">
                <h2>Patients</h2>
                <div class="kpi-row">
                    <div class="kpi-item">
                        <div class="kpi-label">Total</div>
                        <div class="kpi-value" id="kpiTotalPatients">—</div>
                    </div>
                    <div class="kpi-item">
                        <div class="kpi-label">Nouveaux ce mois</div>
                        <div class="kpi-value" id="kpiNewPatients">—</div>
                    </div>
                    <div class="kpi-item">
                        <div class="kpi-label">Rétention</div>
                        <div class="kpi-value" id="kpiRetention">—</div>
                    </div>
                </div>
            </div>

            <div class="an-card">
                <h2>Revenus</h2>
                <div class="kpi-row">
                    <div class="kpi-item">
                        <div class="kpi-label">Total</div>
                        <div class="kpi-value" id="kpiTotalRevenue">—</div>
                    </div>
                    <div class="kpi-item">
                        <div class="kpi-label">Ce mois</div>
                        <div class="kpi-value" id="kpiRevenueThisMonth">—</div>
                    </div>
                    <div class="kpi-item">
                        <div class="kpi-label">Tarif / session</div>
                        <div class="kpi-value" id="kpiTarif">—</div>
                    </div>
                </div>
            </div>

            <div class="an-card">
                <h2>Évaluations</h2>
                <div class="kpi-row">
                    <div class="kpi-item">
                        <div class="kpi-label">Note moyenne</div>
                        <div class="kpi-value gold" id="kpiAvgRating">—</div>
                        <div class="kpi-stars" id="kpiStars"></div>
                    </div>
                    <div class="kpi-item">
                        <div class="kpi-label">Total avis</div>
                        <div class="kpi-value" id="kpiTotalReviews">—</div>
                    </div>
                    <div class="kpi-item">
                        <div class="kpi-label">Évolution</div>
                        <div class="chart-wide" id="ratingChart" style="height:80px;"></div>
                    </div>
                </div>
            </div>

            <div class="an-card">
                <h2>Disponibilité</h2>
                <div class="kpi-row">
                    <div class="kpi-item">
                        <div class="kpi-label">Créneaux total</div>
                        <div class="kpi-value" id="kpiTotalSlots">—</div>
                    </div>
                    <div class="kpi-item">
                        <div class="kpi-label">Réservés</div>
                        <div class="kpi-value" id="kpiBookedSlots">—</div>
                    </div>
                    <div class="kpi-item">
                        <div class="kpi-label">Taux d'occupation</div>
                        <div class="kpi-value" id="kpiOccupancy">—</div>
                    </div>
                </div>
            </div>

            <div class="chart-grid-2">
                <div class="an-card">
                    <h2>Jours les plus actifs</h2>
                    <div class="hbar-list" id="busiestDaysChart"></div>
                </div>
                <div class="an-card">
                    <h2>Heures les plus actives</h2>
                    <div class="hbar-list" id="busiestHoursChart"></div>
                </div>
            </div>

        </div>
        `;
    }

    // ── Render data into DOM ──────────────────────────────────────────────────
    function renderAnalytics(data) {
        set('kpiTotalSessions', data.sessions.total);
        set('kpiSessionsThisMonth', data.sessions.thisMonth);
        set('kpiAvgPerWeek', data.sessions.avgPerWeek);

        set('kpiTotalPatients', data.patients.total);
        set('kpiNewPatients', data.patients.newThisMonth);
        set('kpiRetention', data.patients.retentionRate + '%');

        set('kpiTotalRevenue', data.revenue.total.toLocaleString('fr-FR') + ' DA');
        set('kpiRevenueThisMonth', data.revenue.thisMonth.toLocaleString('fr-FR') + ' DA');
        set('kpiTarif', data.revenue.tarif.toLocaleString('fr-FR') + ' DA');

        set('kpiAvgRating', data.ratings.average.toFixed(1) + ' / 5');
        set('kpiTotalReviews', data.ratings.total);
        const stars = document.getElementById('kpiStars');
        if (stars) {
            const r = Math.round(data.ratings.average);
            stars.textContent = '★'.repeat(r) + '☆'.repeat(5 - r);
        }

        set('kpiTotalSlots', data.availability.totalSlots);
        set('kpiBookedSlots', data.availability.bookedSlots);
        set('kpiOccupancy', data.availability.occupancyRate + '%');

        renderBarChart('sessionsChart', data.sessions.byMonth, m => m.count, m => m.month, '#44AA99');
        renderBarChart('ratingChart', data.ratings.byMonth, m => m.rating || 0, m => m.month, '#c5b4e4');
        renderHBar('busiestDaysChart', data.availability.busiestDays.map(d => ({ name: d.day, count: d.count })), '#091346');
        renderHBar('busiestHoursChart', data.availability.busiestHours.map(h => ({ name: h.hour, count: h.count })), '#44AA99');
    }

    function set(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function renderBarChart(containerId, items, valueFn, labelFn, color) {
        const container = document.getElementById(containerId);
        if (!container || !items?.length) return;

        const max = Math.max(...items.map(valueFn), 1);
        container.innerHTML = items.map(item => {
            const val = valueFn(item);
            const h = Math.max(Math.round((val / max) * 130), 4);
            return `
                <div class="chart-bar-group">
                    <span class="bar-val">${val > 0 ? val : ''}</span>
                    <div class="bar-fill" style="height:${h}px;background:${color};"></div>
                    <span class="bar-label">${labelFn(item)}</span>
                </div>
            `;
        }).join('');
    }

    function renderHBar(containerId, items, color) {
        const container = document.getElementById(containerId);
        if (!container || !items?.length) return;

        const max = Math.max(...items.map(i => i.count), 1);
        container.innerHTML = items.map(item => {
            const pct = Math.max(Math.round((item.count / max) * 100), 2);
            return `
                <div class="hbar-item">
                    <span class="hbar-name">${item.name}</span>
                    <div class="hbar-track">
                        <div class="hbar-fill" style="width:${pct}%;background:${color};"></div>
                    </div>
                    <span class="hbar-count">${item.count}</span>
                </div>
            `;
        }).join('');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAnalytics);
    } else {
        initAnalytics();
    }

})();