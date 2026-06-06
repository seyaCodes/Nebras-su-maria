(function () {
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    // Use relative URL in production so it works on any deployment (Railway, custom domain, etc.)
    const apiUrl = isLocalhost ? 'http://localhost:3000' : '';

    window.APP_CONFIG = {
        apiUrl: apiUrl,
        videoServerUrl: apiUrl,
    };

    window.API_URL = apiUrl + '/api';
})();
