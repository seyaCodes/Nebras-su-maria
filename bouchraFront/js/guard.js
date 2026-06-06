// Hide page immediately before any content shows
document.documentElement.style.visibility = 'hidden';

(async function () {
    const token = localStorage.getItem('nebras_token');
    const user = JSON.parse(localStorage.getItem('nebras_user') || '{}');

    if (!token || !user.id) {
        window.location.href = 'auth.html';
        return;
    }

    try {
        const res = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();

        if (!data.user) { window.location.href = 'auth.html'; return; }

        localStorage.setItem('nebras_user', JSON.stringify(data.user));

        if (data.user.status === 'pending') {
            window.location.href = 'pending.html'; return;
        }
        if (data.user.status === 'rejected' || data.user.status === 'suspended') {
            localStorage.clear();
            window.location.href = 'auth.html'; return;
        }

        // ✅ User is active — show the page
        document.documentElement.style.visibility = 'visible';

    } catch (e) {
        localStorage.clear();
        window.location.href = 'auth.html';
    }
})();